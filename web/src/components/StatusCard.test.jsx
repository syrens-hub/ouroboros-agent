import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { CheckCircle } from 'lucide-react'
import { StatusCard, ConnectionStatus } from './StatusCard'

describe('StatusCard', () => {
  it('renders title and value', () => {
    render(<StatusCard title="CPU" value="42%" />)
    expect(screen.getByText('CPU')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
  })

  it('renders custom icon and status color', () => {
    render(<StatusCard title="Health" value="OK" status="success" icon={CheckCircle} />)
    expect(screen.getByText('Health')).toBeInTheDocument()
    expect(screen.getByText('OK')).toHaveClass('text-ok')
  })

  it('renders progress bar when progress is provided', () => {
    const { container } = render(<StatusCard title="Memory" value="80%" progress={80} />)
    const bar = container.querySelector('[style*="width: 80%"]')
    expect(bar).toBeInTheDocument()
  })
})

describe('ConnectionStatus', () => {
  it('shows connected state', () => {
    render(<ConnectionStatus connected={true} label="Online" />)
    expect(screen.getByText('Online')).toHaveClass('text-ok')
  })

  it('shows disconnected state', () => {
    render(<ConnectionStatus connected={false} label="Offline" />)
    expect(screen.getByText('Offline')).toHaveClass('text-danger')
  })
})
