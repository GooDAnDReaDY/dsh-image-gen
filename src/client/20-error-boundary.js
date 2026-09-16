    function createErrorBoundary() {
      if (!React || typeof React.Component !== 'function') {
        return function NoopBoundary(props) { return props?.children || null }
      }
      return class ErrorBoundary extends React.Component {
        constructor(props) {
          super(props)
          this.state = { hasError: false, error: null }
        }
        static getDerivedStateFromError(error) {
          return { hasError: true, error }
        }
        componentDidCatch(error, errorInfo) {
          console.error('[dsh-image-gen] UI Crash caught by ErrorBoundary:', error, errorInfo)
        }
        render() {
          if (this.state.hasError) {
            return react.createElement(
              'div',
              {
                className: 'ig-alert-err',
                style: { margin: '12px 0', padding: '14px', borderRadius: '8px' },
              },
              react.createElement('div', { style: { fontWeight: 600, marginBottom: '6px' } }, '⚠️ Image Gen UI Error:'),
              react.createElement('div', { style: { fontSize: '12px', wordBreak: 'break-all' } }, String(this.state.error?.message || this.state.error)),
              react.createElement(
                'button',
                {
                  type: 'button',
                  className: 'ig-btn',
                  style: { marginTop: '10px', fontSize: '12px', padding: '4px 10px' },
                  onClick: () => this.setState({ hasError: false, error: null }),
                },
                'Retry'
              )
            )
          }
          return this.props.children
        }
      }
    }
    const ErrorBoundary = createErrorBoundary()

