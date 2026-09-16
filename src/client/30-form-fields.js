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

