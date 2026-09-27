# Creative Tools Suite & Interactive Canvas (v0.11.12)

Implementation plan for 5 major features requested:
- #181: Character Sheet Generator (`generate_character_sheet`)
- #183: Portrait Reference & Facial Consistency (`face_reference`, FaceID / IP-Adapter)
- #180: OCR Localization & Text Replacement (`replace_image_text`) via `dsh-vision-bridge`
- #185: 3D Isometric Diagram Beautifier (`beautify_diagram`)
- #328: Inpainting Canvas in chat card (`FalImageCard`)
- #329: Live Generation Progress Stream (steps & queue status)

## Strategy
- 1 isolated commit per issue
- 1 final PR merge into main
- Full test pass (260+ tests, preflight.sh)
- Release v0.11.12, sanitized GitHub mirror push, npm publish
- Production deploy to MiniAI profile `web` & restart dsh-web.service

## Progress Status
- [ ] Phase 1: #181 character_sheet_generator tool & layout synthesis
- [ ] Phase 2: #183 face_reference portrait consistency (FaceID / IP-Adapter)
- [ ] Phase 3: #180 replace_image_text OCR localization via dsh-vision-bridge
- [ ] Phase 4: #185 beautify_diagram 3D architectural visualization
- [ ] Phase 5: #328 interactive inpainting canvas in FalImageCard
- [ ] Phase 6: #329 live preview progress stream & steps indicator
- [ ] Phase 7: Pull request, full test verification & merge into main
- [ ] Phase 8: Release v0.11.12, npm publication, GitHub mirror & production deploy
