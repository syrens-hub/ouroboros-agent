import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SystemControlPanel, RealtimeMetrics, AlertConsole } from './index.js'

describe('SystemControlPanel', () => {
  it('renders cards and triggers onToggle', () => {
    const onToggle = vi.fn()
    render(
      <SystemControlPanel
        status={{
          selfHealing: true,
          scheduler: false,
          knowledgeBase: true,
          browser: false,
          canvas: false,
          daemon: true,
        }}
        onToggle={onToggle}
      />
    )

    expect(screen.getByText('Self-Healing')).toBeInTheDocument()
    expect(screen.getByText('Task Scheduler')).toBeInTheDocument()
    expect(screen.getByText('Knowledge Base')).toBeInTheDocument()
    expect(screen.getByText('Browser')).toBeInTheDocument()
    expect(screen.getByText('Canvas')).toBeInTheDocument()
    expect(screen.getByText('Daemon')).toBeInTheDocument()

    const schedulerCard = screen.getByText('Task Scheduler').parentElement.parentElement
    const schedulerToggle = schedulerCard.querySelector('button[aria-pressed]')
    fireEvent.click(schedulerToggle)
    expect(onToggle).toHaveBeenCalledWith('scheduler', true)
  })
})

describe('RealtimeMetrics', () => {
  it('renders SVG bars', () => {
    render(
      <RealtimeMetrics
        metrics={[
          { label: 'Cache Hit', value: 0.82 },
          { label: 'Token Usage', value: 0.45 },
          { label: 'LLM Latency', value: 0.23 },
        ]}
      />
    )

    expect(screen.getByText('Cache Hit')).toBeInTheDocument()
    expect(screen.getByText('Token Usage')).toBeInTheDocument()
    expect(screen.getByText('LLM Latency')).toBeInTheDocument()

    const bars = document.querySelectorAll('[style*="width"]')
    expect(bars.length).toBeGreaterThanOrEqual(2)

    const polyline = document.querySelector('polyline')
    expect(polyline).toBeInTheDocument()
  })
})

describe('AlertConsole', () => {
  it('renders alerts with correct types', () => {
    render(
      <AlertConsole
        alerts={[
          { type: 'security', message: 'Permission denied', timestamp: 1713000000000 },
          { type: 'webhook', message: 'Webhook delivered', timestamp: 1713000100000 },
        ]}
      />
    )

    expect(screen.getByText('Permission denied')).toBeInTheDocument()
    expect(screen.getByText('Webhook delivered')).toBeInTheDocument()
    expect(screen.getByText('Security')).toBeInTheDocument()
    expect(screen.getByText('Webhook')).toBeInTheDocument()
  })

  it('shows empty state', () => {
    render(<AlertConsole alerts={[]} />)
    expect(screen.getByText('暂无告警')).toBeInTheDocument()
  })
})
