# desksync.org design notes

Extends the extension's own look on purpose: the site should read as the same product.

| Field | Choice | Source |
|---|---|---|
| Ground | Mid-light grey `#e7e7e4` | The extension's popup ground |
| Palette | Grey, ink `#141414`, yellow `#ffd84d` | The extension's tokens (yellow = its note header and highlight) |
| Type | System UI stack only | The extension uses the system font; the site matches what users see in the popup |
| Layout primitive | White panels on grey, like the popup's panes | The popup's list/pane surfaces |
| Surface | Panels, one dark section (security, "the locked part"), one yellow closing band | Vault = locked/dark; yellow = the product's accent |
| Signature | The four-kinds strip shaped like the extension's rail, and real `<kbd>` shortcuts | The product is keyboard-driven and has exactly those four kinds |

Content rules: every claim comes from README.md, PRIVACY.md or docs/STORE_LISTING.md. No testimonials, user counts
or ratings until real ones exist. Plan numbers must match `PLANS` in extension/lib/client.js.

Known common elements kept, with reason: FAQ (real pre-install questions: free?, account?, passwords, uninstall);
two-plan pricing (it is the product's actual offer).
