    // -------------------------------------------------------------- CSS & Design System
    function ensureCss() {
      if (typeof document === 'undefined') return
      if (document.getElementById('dsh-image-gen-full-css')) return
      const style = document.createElement('style')
      style.id = 'dsh-image-gen-full-css'
      style.dataset.dshPlugin = NS
      style.textContent = `
.ig-page{display:flex;flex-direction:column;gap:18px;padding:4px 0 24px;max-width:1000px}
.ig-header{display:flex;flex-direction:column;gap:8px;padding-bottom:14px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.ig-page-title{font-size:20px;font-weight:700;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:10px}
.ig-page-sub{font-size:13px;color:var(--dsw-alias-label-secondary);line-height:1.5}

.ig-section-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:16px 18px;display:flex;flex-direction:column;gap:14px}
.ig-section-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);display:flex;align-items:center;justify-content:space-between}
.ig-section-desc{font-size:13px;color:var(--dsw-alias-label-secondary);margin-top:-6px;line-height:1.4}

.ig-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.ig-grid-2{display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:12px}
.ig-grid-4{display:grid;grid-template-columns:repeat(auto-fit, minmax(190px, 1fr));gap:10px}

.ig-stat-box{padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:4px}
.ig-stat-val{font-size:16px;font-weight:700;color:var(--dsw-alias-label-primary)}
.ig-stat-lbl{font-size:12px;color:var(--dsw-alias-label-secondary)}

.ig-badge{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);display:inline-flex;align-items:center;gap:5px;font-weight:500}
.ig-badge-ok{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent)}
.ig-badge-warn{border-color:var(--dsw-alias-state-warning-primary);color:var(--dsw-alias-state-warning-primary);background:color-mix(in srgb, var(--dsw-alias-state-warning-primary) 8%, transparent)}
.ig-badge-bad{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)}

.ig-tabs{display:flex;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l2);padding-bottom:8px;margin-bottom:6px;overflow-x:auto}
.ig-tab-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:6px;padding:6px 12px;font-size:13px;background:transparent;color:var(--dsw-alias-label-secondary);font-weight:500;display:inline-flex;align-items:center;gap:6px;transition:all .15s ease}
.ig-tab-btn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.ig-tab-btn-active{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);font-weight:600}

.ig-field{display:flex;flex-direction:column;gap:5px;padding:8px 0}
.ig-field-head{display:flex;justify-content:space-between;align-items:center}
.ig-field-label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}
.ig-field-hint{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.4}
.ig-field-err{font-size:12px;color:var(--dsw-alias-state-error-primary);margin-top:2px}

.ig-input,.ig-select{height:34px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;width:100%;box-sizing:border-box}
.ig-input:focus,.ig-select:focus{outline:none;border-color:var(--dsw-alias-state-brand-primary)}
.ig-input-invalid{border-color:var(--dsw-alias-state-error-primary)}
.ig-input:disabled,.ig-select:disabled{opacity:0.5;cursor:not-allowed}

.ig-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 14px;font-size:13px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:500;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:all .15s ease}
.ig-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-4, var(--dsw-alias-bg-layer-2));border-color:var(--dsw-alias-label-dimmed, var(--dsw-alias-border-l2))}
.ig-btn-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);border-color:transparent}
.ig-btn-primary:hover:not(:disabled){opacity:0.9}
.ig-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.ig-btn-danger:hover:not(:disabled){background:var(--dsw-alias-state-error-bg, color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent));border-color:var(--dsw-alias-state-error-primary)}
.ig-btn-disabled{opacity:0.5;cursor:not-allowed}

.ig-reset{font-size:11px;color:var(--dsw-alias-state-brand-primary);background:none;border:none;cursor:pointer;padding:0;text-decoration:underline}
.ig-reset:hover{opacity:0.8}

.ig-alert-ok{padding:10px 14px;border-radius:8px;background:var(--dsw-alias-state-success-bg, color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent));color:var(--dsw-alias-state-success-primary);font-size:13px}
.ig-alert-bad{padding:10px 14px;border-radius:8px;background:var(--dsw-alias-state-error-bg, color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent));color:var(--dsw-alias-state-error-primary);font-size:13px}
.ig-alert-err{padding:10px 14px;border-radius:8px;background:var(--dsw-alias-state-error-bg, color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent));color:var(--dsw-alias-state-error-primary);font-size:13px}
.ig-banner-warning{padding:12px 16px;border-radius:8px;background:var(--dsw-alias-state-warning-bg, color-mix(in srgb, var(--dsw-alias-state-warning-primary) 12%, transparent));border:1px solid var(--dsw-alias-state-warning-primary);color:var(--dsw-alias-state-warning-primary);font-size:13px;display:flex;align-items:center;gap:10px;font-weight:500}

.ig-inpaint-box{position:relative;margin-top:10px;padding:12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:8px}
.ig-matrix-grid{display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:10px;margin-top:8px}
.ig-matrix-cell{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column}
.ig-matrix-img{width:100%;aspect-ratio:1/1;object-fit:cover;cursor:pointer}
.ig-matrix-bar{display:flex;justify-content:space-between;align-items:center;padding:6px 10px;font-size:11px}

/* Backward-compatibility alias styles for toolview */
.fal_head{font-size:13px;font-weight:600;margin-bottom:8px;color:var(--dsw-alias-label-primary)}
.ig-prompt{font-size:13px;padding:8px 12px;background:var(--dsw-alias-bg-layer-2);border-radius:6px;border:1px solid var(--dsw-alias-border-l2);margin-bottom:8px;word-break:break-word}
.ig-meta{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:6px}
.ig-err{padding:10px;border-radius:6px;background:var(--dsw-alias-state-error-bg, color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent));color:var(--dsw-alias-state-error-primary);font-size:12px}
`
      document.head.appendChild(style)
    }
