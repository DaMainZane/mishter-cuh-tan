
```
BUG 1
Saw:        optimization
Expected:   Optimized big map to reduce lag when moving around the screen
Actual:     lag spike, stuttering, and framerate issues persist
Before it:  none
Repro:      none
Severity:   Annoying
Error text: none
Screenshot: none
```

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


```
BUG
Saw:        gameplay
Expected:   resources under flood give half rounded up per settlement 
Actual:     tide bug with resources (roll no resources when tile is flooded), even though it supposed to roll half rounded up
Before it:  none
Repro:      dlc - tidebound
Severity:   wrong rule
Error text: none
Screenshot: none
```

```
BUG
Saw:        gameplay
Expected:   port should have a node of interaction, harbor upgrade interaction should be on the port not on the city
Actual:     to do port upgrade to harbor, you have to click on the city Before it:  none
Repro:      dlc - tidebound
Severity:   wrong rule
Error text: none
Screenshot: none
```

```
BUG
Saw:        UI
Expected:   harbor should replace sprite for port
Actual:     the sprite for harbor look the same
Before it:  none
Repro:      dlc - tidebound
Severity:   wrong visual
Error text: none
Screenshot: none
```

```
BUG
Saw:        gameplay
Expected:   fish spawn in cluster but not too much, only enough to incentivize net and not actually cluster up the screen
Actual:     fish spawn is too much, reduce it by 30%
Before it:  none
Repro:      dlc - tidebound
Severity:   wrong rule
Error text: none
Screenshot: none
```

```
BUG
Saw:        gameplay
Expected:   harbor should be able to trade with 2:1 ratio and even 1:1 with upgrade tech when it is flooded
Actual:     harbor does not work (when flooded)
Before it:  none
Repro:      dlc - tidebound
Severity:   wrong rule
Error text: none
Screenshot: none
```

```
BUG
Saw:        gameplay
Expected:   feed supposed to be a tile interaction, in which the player can select a tile with a next (only these tiles) to replenish fish
Actual:     feed does not have a node of interaction to interact with (add for net, reuses tile selection from groundwork)
Before it:  none
Repro:      dlc - tidebound
Severity:   wrong rule
Error text: none
Screenshot: none
```

```
BUG
Saw:        UI
Expected:   updated harbor and other tidebound related hover tooltip to the newest gameplay mechanic respectively
Actual:     still have old hover tooltip texts
Before it:  none
Repro:      dlc - tidebound
Severity:   wrong visual
Error text: none
Screenshot: none
```

```
BUG
Saw:        gameplay
Expected:   fish function like resource (receive resource multiplier from settlement and city and so on), fish multiplier bonus does not count as 2 from fish boost, but only one.
Actual:     fish doesnt get multiplier bonus if it is a city 
Before it:  none
Repro:      dlc - tidebound
Severity:   wrong rule
Error text: none
Screenshot: none
```

```
BUG
Saw:        gameplay
Expected:   clicking on stacked fish in hand (more than 1), uses all fish token and allow client to select all resources equal to fish token in hand
Actual:     having to select manually one by one
Before it:  none
Repro:      dlc - tidebound
Severity:   wrong rule
Error text: none
Screenshot: none
```