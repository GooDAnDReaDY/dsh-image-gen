    // -------------------------------------------------------------- UI Components
    function Field(props) {
      const { entry, state, fieldProps, t, onEdit, onReset } = props
      const id = 'dsh-image-gen-' + entry.field
      const label = t(entry.labelKey)
      const hint = t(entry.hintKey)
      const overridden = Boolean(state.overridden)
      const invalid = Boolean(state.invalid)
      const disabled = Boolean(fieldProps.disabled)

      if (entry.kind === 'select') {
        const px = entry.sizePixels && entry.sizePixels[state.text] ? ' — ' + entry.sizePixels[state.text] : ''
        const need = entry.providerNeeds && entry.providerNeeds[state.text] ? ' (' + t(entry.providerNeeds[state.text]) + ')' : ''
        return react.createElement(
          'div',
          { className: 'ig-field', key: entry.field },
          react.createElement(
            'div',
            { className: 'ig-field-head' },
            react.createElement('label', { className: 'ig-field-label', htmlFor: id }, label),
            overridden
              ? react.createElement(
                  'div',
                  { className: 'ig-row' },
                  react.createElement('span', { className: 'ig-badge ig-badge-warn' }, fieldProps.overriddenLabel),
                  react.createElement('button', { type: 'button', className: 'ig-reset', disabled, onClick: onReset }, fieldProps.resetLabel)
                )
              : null
          ),
          react.createElement(
            'select',
            {
              id,
              className: 'ig-select',
              value: state.text,
              disabled,
              onChange: (e) => onEdit(e.target.value),
            },
            entry.options.map((opt) =>
              react.createElement('option', { key: opt, value: opt }, opt === '' ? t('f.inherit') : opt)
            )
          ),
          react.createElement('p', { className: 'ig-field-hint' }, hint + px + need)
        )
      }

      return react.createElement(
        'div',
        { className: 'ig-field', key: entry.field },
        react.createElement(
          'div',
          { className: 'ig-field-head' },
          react.createElement('label', { className: 'ig-field-label', htmlFor: id }, label),
          overridden
            ? react.createElement(
                'div',
                { className: 'ig-row' },
                react.createElement('span', { className: 'ig-badge ig-badge-warn' }, fieldProps.overriddenLabel),
                react.createElement('button', { type: 'button', className: 'ig-reset', disabled, onClick: onReset }, fieldProps.resetLabel)
              )
            : null
        ),
        react.createElement('input', {
          id,
          className: invalid ? 'ig-input ig-input-invalid' : 'ig-input',
          type: 'text',
          ...(entry.kind === 'number' ? { inputMode: 'numeric' } : {}),
          'aria-invalid': invalid ? true : undefined,
          'aria-describedby': invalid ? id + '-err' : undefined,
          value: state.text,
          placeholder: entry.placeholderKey ? t(entry.placeholderKey) : '',
          disabled,
          onChange: (e) => onEdit(e.target.value),
        }),
        react.createElement('p', {
          id: invalid ? id + '-err' : undefined,
          role: invalid ? 'alert' : undefined,
          className: invalid ? 'ig-field-err' : 'ig-field-hint',
        }, invalid ? fieldProps.invalidLabel : hint)
      )
    }



