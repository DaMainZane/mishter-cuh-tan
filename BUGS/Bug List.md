
```
BUG 5
Saw:        UI
Expected:   Rework the build interaction UI as follows:

1. **Hotspots:** Every valid build node (vertex/edge) shows a pulsing, semi-transparent marker as an interaction affordance. Only valid placements are shown, and invalid ones are hidden.
2. **Contextual popover:** Clicking a hotspot opens a small popover anchored to that node, listing only the pieces that can legally be placed there (e.g. Settlement, City, Road). Clicking outside or pressing Esc closes it.
3. **Cost tooltip:** Hovering any option in the popover shows a tooltip with its resource cost, using the resource icons with quantities (reuse what we already have). Resources the player lacks are shown dimmed. Options the player can’t afford are disabled but still show the tooltip.
4. **Consistency:** The same tooltip component is used on the bottom build toolbar (Harbor / Settle / City), so cost is visible before entering placement mode.
5. **Input:** Tooltips appear on hover with a short delay (~150 ms) on desktop, and on long-press on touch.
Actual:     currently is one long line of buttons
Before it:  none
Repro:      all
Severity:   wrong visual
Error text: none
Screenshot: image 1, 2, and 3 in Coding Project/colonist-custom-catan/BUGS/Image
```