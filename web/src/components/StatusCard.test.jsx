import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusCard, ConnectionStatus } from './StatusCard.jsx'
import { AlertCircle } from 'lucide-react'

describe('StatusCard', () => {
  it('renders title and value', () => {
    render(<StatusCard title="CPU" value="42%" />)
    expect(screen.getByText('CPU')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
  })

  it('renders with warning status', () => {
    render(<StatusCard title="Memory" value="85%" status="warning" />)
    expect(screen.getByText('Memory')).toBeInTheDocument()
    expect(screen.getByText('85%')).toBeInTheDocument()
  })

  it('renders custom icon', () => {
    render(<StatusCard title="Errors" value="3" icon={AlertCircle} />)
    expect(screen.getByText('Errors')).toBeInTheDocument()
  })

  it('renders progress bar when progress is provided', () => {
    const { container } = render(<StatusCard title="Disk" value="60%" progress={60} />)
    const progressBar = container.querySelector('[style*="width: 60%"]')
    expect(progressBar).not.toBeNull()
  })
})

describe('ConnectionStatus', () => {
  it('renders connected state', () => {
    render(<ConnectionStatus connected={true} label="Online" />)
    expect(screen.getByText('Online')).toBeInTheDocument()
  })

  it('renders disconnected state', () => {
    render(<ConnectionStatus connected={false} label="Offline" />)
    expect(screen.getByText('Offline')).toBeInTheDocument()
  })
})
