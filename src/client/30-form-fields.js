    // -------------------------------------------------------------- Form & Specs
    const booleanField = (field) => ({
      field,
      format: (value) => (value === true || value === 'true' ? 'true' : value === false || value === 'false' ? 'false' : ''),
      parse: (text) => {
        if (text === '') return { kind: 'clear' }
        if (text === 'true') return { kind: 'set', value: true }
        if (text === 'false') return { kind: 'set', value: false }
        return void 0
      },
    })

    function textField(field) {
      return {
        field,
        format: (value) => (typeof value === 'string' ? value : ''),
        parse: (text) => {
          if (text === '') return { kind: 'clear' }
          return { kind: 'set', value: text }
        },
      }
    }

    function numberField(field) {
      return {
        field,
        format: (value) => (typeof value === 'number' ? String(value) : ''),
        parse: (text) => {
          if (text === '') return { kind: 'clear' }
          const value = Number(text)
          return Number.isFinite(value) ? { kind: 'set', value } : void 0
        },
      }
    }

    function selectField(field, options) {
      const set = new Set(options)
      return {
        field,
        format: (value) => (typeof value === 'string' ? value : ''),
        parse: (text) => {
          if (text === '') return { kind: 'clear' }
          return set.has(text) ? { kind: 'set', value: text } : void 0
        },
      }
    }

    function arrayField(field) {
      return {
        field,
        format: (value) => (Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : ''),
        parse: (text) => {
          if (text === '') return { kind: 'clear' }
          const items = text.split(',').map((s) => s.trim()).filter(Boolean)
          return { kind: 'set', value: items }
        },
      }
    }

    function jsonField(field) {
      return {
        field,
        format: (value) => {
          if (typeof value === 'string') return value
          if (value && typeof value === 'object') {
            try { return JSON.stringify(value, null, 2) } catch { return '' }
          }
          return ''
        },
        parse: (text) => {
          if (text === '') return { kind: 'clear' }
          try {
            JSON.parse(text)
            return { kind: 'set', value: text }
          } catch (_) {
            return void 0
          }
        },
      }
    }

