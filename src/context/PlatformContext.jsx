import { createContext, useContext } from 'react'
import { useParams, Navigate, Outlet } from 'react-router-dom'

const PlatformContext = createContext()

const VALID_PLATFORMS = ['ccai', 'dc', 'materia', 'phs']

export const PLATFORM_NAMES = {
  ccai: 'CCAI',
  dc: 'DC',
  materia: 'Materia',
  phs: 'PHS'
}

export function PlatformProvider() {
  const { platform } = useParams()
  
  if (!platform || !VALID_PLATFORMS.includes(platform.toLowerCase())) {
    return <Navigate to="/choose-platform" replace />
  }

  const activePlatform = platform.toLowerCase()

  return (
    <PlatformContext.Provider value={{ activePlatform }}>
      <Outlet />
    </PlatformContext.Provider>
  )
}

export function usePlatform() {
  return useContext(PlatformContext)
}
