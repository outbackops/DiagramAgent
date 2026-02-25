# UI Polish & Interaction Fixes — TODO

## Overview
Fix 12 identified issues across chat flow, clarify panel, diagram rendering, and code editor to make the full user experience smooth, responsive, and bug-free.

---

## 1. Fix "Other" freetext in ClarifyPanel
**File:** `src/components/ClarifyPanel.tsx`
- [ ] When a user selects an option with value `"other"` (case-insensitive), show an inline text input below the option pills for that question
- [ ] Track the "Other" text separately in answers as `"other: <user text>"`
- [ ] On submit, merge the freetext value into the answer so the enhanced prompt includes it

## 2. Fix silently dropped prompt when clarify panel is visible
**File:** `src/app/page.tsx` — `handleSend`
- [ ] When `clarifyQuestions` is shown and the user sends a new prompt via the text input, dismiss the current clarify panel and restart the clarify flow with the new prompt
- [ ] Prevents the confusing "nothing happens" behavior

## 3. Improve clarify API prompt for technical accuracy
**File:** `src/app/api/clarify/route.ts`
- [ ] Add rules: options must be mutually exclusive within a `single` question, technically accurate (no mixing abstraction levels), and not redundant with the user's prompt
- [ ] Instruct the LLM to always include an `"Other"` option as the last option for `single` and `multi` questions
- [ ] Remove the `"freetext"` type entirely — replace with the "Other" freetext mechanism on `single`/`multi` questions

## 4. Auto-scroll to clarify panel and generating spinner
**File:** `src/components/PromptInput.tsx`
- [ ] Add `inlinePanel` and `isGenerating` to the scroll `useEffect` dependencies so the chat auto-scrolls when the clarify panel appears or generation starts
- [ ] Auto-focus the textarea after sending a message using the existing `inputRef`

## 5. Make CodeEditor read-only during generation
**Files:** `src/app/page.tsx`, `src/components/CodeEditor.tsx`
- [ ] Pass `isGenerating` as a `readOnly` prop to `CodeEditor`
- [ ] Set Monaco's `readOnly` option when generation is active

## 6. Prevent D2Renderer render-storm during streaming
**File:** `src/components/D2Renderer.tsx`
- [ ] Increase debounce to 800ms during active streaming (detect via a new `isStreaming` prop, or check for rapid code changes)
- [ ] Add an `AbortController` for in-flight render requests so a new render cancels the previous one
- [ ] Only reset zoom/pan when the SVG changes AND streaming is finished (preserve zoom during streaming)

## 7. Clean up refinement status timeout
**File:** `src/app/page.tsx` (~line 208)
- [ ] Store the `setTimeout` ID in a ref and clear it in the `useEffect` cleanup or in `handleNewDiagram`

## 8. Pass AbortSignal to assessment fetch
**File:** `src/app/page.tsx` — `assessDiagram`
- [ ] Thread the `controller.signal` through to the `assessDiagram` fetch call so abort actually cancels it

## 9. Add button/UI state feedback throughout the flow
- [ ] **ClarifyPanel:** Show a loading spinner on the "Generate Diagram" button text when submitting; disable "Skip" during submit
- [ ] **ChatPanel:** Show "Analyzing..." placeholder during `isClarifying` instead of "Generating diagram..."
- [ ] **Header:** Show the current phase in the refinement status bar with a progress indicator (e.g., "1 of 3")
- [ ] **New diagram button:** Confirm if generation is in-flight before resetting

## 10. Validate clarify answers before submit
**File:** `src/components/ClarifyPanel.tsx`
- [ ] Require at least 1 question answered before enabling the "Generate Diagram" button
- [ ] Show `(0/N answered)` vs `(3/N answered)` as dynamic label

## 11. Fix D2Renderer race condition
**File:** `src/components/D2Renderer.tsx`
- [ ] Track a render request ID; when the response arrives, only apply it if the ID matches the latest request
- [ ] Prevents an older slow render from overwriting a newer fast one

## 12. End-to-end testing
Manual test matrix — all must pass:
- [ ] **Flow A:** New prompt → clarify questions → answer some → generate → verify horizontal layout
- [ ] **Flow B:** New prompt → clarify → select "Other" on a question → type freetext → generate → verify custom text in diagram
- [ ] **Flow C:** New prompt → clarify → skip → generate → verify diagram still generates
- [ ] **Flow D:** New prompt → clarify showing → type a different prompt → verify clarify restarts
- [ ] **Flow E:** Existing diagram → type update → verify no clarify, direct generation
- [ ] **Flow F:** During generation → click "New" → verify clean reset
- [ ] **Flow G:** During generation → verify editor is read-only, buttons disabled, no render loops
- [ ] **Flow H:** After generation → zoom/pan the diagram → verify it stays zoomed
- [ ] **Flow I:** Vision refine toggle off → generate → verify no assessment loop
