import { useState, useCallback, useRef } from 'react'

export function useVoiceSearch({ onResult, language = 'hi-IN' }) {
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
        
        const transcript = finalTranscript || interimTranscript
        if (transcript && onResult) {
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
