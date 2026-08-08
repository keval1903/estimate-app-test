import { useState, useCallback, useRef } from 'react'
import { VOICE_PHONETIC_MAP } from '../lib/synonyms'

function cleanTranscript(text) {
  if (!text) return text;
  let cleaned = text.toLowerCase();
  
  // Apply all phonetic corrections from our map
  for (const [misheard, correct] of Object.entries(VOICE_PHONETIC_MAP)) {
    // We use word boundaries \b so we don't accidentally replace parts of words
    // e.g. replacing 'for' -> '4' shouldn't turn 'format' into '4mat'
    const regex = new RegExp(`\\b${misheard}\\b`, 'g');
    cleaned = cleaned.replace(regex, correct);
  }

  // Common phonetic errors for hardware/plywood industry
  cleaned = cleaned.replace(/\bmm\b/g, ' mm '); // ensure spacing around mm
  // Collapse multiple spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

export function useVoiceSearch({ onResult, language = 'en-IN' }) {
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState(null)
  const recognitionRef = useRef(null)

  const startListening = useCallback(() => {
    // Check for browser support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError('Voice search is not supported in your browser.')
      alert('Voice search is not supported in this browser/device. Try using Chrome or Edge.')
      return
    }

    try {
      const recognition = new SpeechRecognition()
      recognitionRef.current = recognition
      
      recognition.lang = language // 'en-IN' or 'hi-IN' works best for Indian English / Hindi mix
      recognition.continuous = true
      recognition.interimResults = true // Show real-time typing

      recognition.onstart = () => {
        setIsListening(true)
        setError(null)
      }

      recognition.onresult = (event) => {
        let finalTranscript = ''
        let interimTranscript = ''
        
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript
          } else {
            interimTranscript += event.results[i][0].transcript
          }
        }
        
        let transcript = finalTranscript || interimTranscript
        if (transcript && onResult) {
          transcript = cleanTranscript(transcript)
          onResult(transcript)
        }
      }

      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error)
        let msg = event.error;
        if (event.error === 'not-allowed') msg = 'Microphone access denied. Please allow mic permissions in browser settings.'
        setError(`Error: ${msg}`)
        alert(`Voice Error: ${msg}`)
        setIsListening(false)
      }

      recognition.onend = () => {
        setIsListening(false)
      }

      recognition.start()
    } catch (err) {
      console.error('Failed to start speech recognition:', err)
      setError(err.message)
      alert(`Voice Error: ${err.message}`)
      setIsListening(false)
    }
  }, [language, onResult])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }
  }, [])

  return {
    isListening,
    error,
    startListening,
    stopListening
  }
}
