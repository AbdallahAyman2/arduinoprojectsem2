# Design System Document: Industrial Precision & Organic Growth

## 1. Overview & Creative North Star: "The Digital Greenhouse"
This design system moves away from the sterile, "boxy" nature of traditional industrial dashboards. Our Creative North Star is **The Digital Greenhouse**: an experience that balances the rigid reliability of IoT infrastructure with the organic, breathing nature of horticulture.

We achieve a high-end editorial feel by breaking the standard dashboard "grid of boxes." Instead, we utilize **intentional asymmetry**, high-contrast typographic scales (pairing the architectural Manrope with the functional Inter), and a layering philosophy that mimics stacked glass panes. This isn't just a tool; it's a premium command center that feels both authoritative and approachable.

---

## 2. Colors & Tonal Depth
We utilize a sophisticated palette where "Green" isn't just a status—it's the lifeblood of the interface.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders to section off content. Traditional lines create visual clutter that degrades the premium feel. Boundaries must be defined through:
1. **Background Shifts:** Placing a `surface-container-low` element on a `surface` background.
2. **Tonal Transitions:** Using subtle shifts in saturation to indicate change.

### Surface Hierarchy & Nesting
Treat the UI as a physical environment. Use the surface-container tiers to create nested depth:
*   **Base Layer:** `surface` (#f7f9ff) – The primary canvas.
*   **Secondary Sections:** `surface-container-low` – Use for large sidebar areas or secondary navigation.
*   **Interactive Cards:** `surface-container-lowest` (#ffffff) – Reserved for high-priority data visualizations.
*   **Tertiary Accents:** `surface-container-high` – For small, non-interactive informative blocks.

### The "Glass & Gradient" Rule
To inject "soul" into the industrial vibe:
*   **Glassmorphism:** For floating modals or "Hover" states on cards, use `surface` at 80% opacity with a `20px` backdrop-blur.
*   **Signature Gradients:** Primary CTAs should utilize a linear gradient from `primary` (#006d37) to `primary_container` (#2ecc71) at a 135-degree angle. This adds a "jewel-like" depth that a flat hex code cannot replicate.

---

## 3. Typography
Our typography is a dialogue between the **Manrope** (Editorial/Display) and **Inter** (Functional/UI).

*   **Display & Headlines (Manrope):** Use `display-lg` and `headline-md` for high-level plant health metrics or facility names. The wide apertures of Manrope convey modern, industrial transparency.
*   **UI & Titles (Inter):** All interactive elements, labels, and sub-headers use Inter. It provides the "functional" grounding required for IoT reliability.
*   **Data Logs (Monospace):** For raw sensor outputs or system logs, use a high-quality Monospace font. This signals "Technical Truth" to the user, separating human-readable insights from machine-generated data.

---

## 4. Elevation & Depth
We eschew the "material" shadow in favor of **Ambient Tonal Layering**.

*   **The Layering Principle:** Place a `surface-container-lowest` card on top of a `surface-container-low` section. This creates a natural, soft "lift" without a single pixel of shadow.
*   **Ambient Shadows:** For floating elements (like the "Active Alerts" tray), use an extra-diffused shadow: `Y: 8px, Blur: 24px, Color: on_surface @ 6%`. The shadow must be tinted with the surface color to avoid looking like "dirt" on the screen.
*   **The "Ghost Border" Fallback:** If accessibility requires a container boundary, use the `outline_variant` token at **15% opacity**. It should be felt, not seen.

---

## 5. Components

### Status Badges (The "Signal" Component)
Status is the heartbeat of FloraCraft.
*   **Styling:** Use a `full` (9999px) radius. 
*   **Color Logic:** 
    *   *ON/OPEN:* `primary_container` background with `on_primary_container` text.
    *   *MOVING/TEST:* `tertiary_container` background with `on_tertiary_container` text.
    *   *OFF/CLOSED:* `surface_variant` background with `on_surface_variant` text.

### Cards & Lists
*   **Geometry:** Use `xl` (1.5rem / 24px) for main dashboard cards and `lg` (1rem / 16px) for nested elements.
*   **Spacing:** Forbid divider lines. Use `1.5rem` or `2rem` of vertical white space to separate list items.
*   **Interaction:** On hover, a card should shift from `surface-container-lowest` to a subtle `surface-bright` with an ambient shadow.

### Input Fields
*   **Style:** Minimalist. No bottom border. Use a `surface-container-high` fill with a `md` (0.75rem) corner radius.
*   **State:** The active state is indicated by a 2px `primary` highlight on the *left side only*, rather than a full-box outline.

### Industrial-Specific Components
*   **Sparklines:** Integrated directly into data cards without axes or labels to show "The Pulse" of sensor data over time. Use `primary` for the line color.
*   **The "Scrub Bar":** A custom slider for historical data playback, utilizing `primary_fixed` for the track and a large `primary` thumb for easy touch/mouse interaction.

---

## 6. Do's and Don'ts

### Do
*   **Do** use asymmetrical layouts. A large metric card on the left balanced by two smaller logs on the right creates a sophisticated, editorial rhythm.
*   **Do** utilize `surface-dim` for dark mode transitions to maintain legibility without losing the "industrial" slate vibe.
*   **Do** treat white space as a structural element. It is the "air" in the greenhouse.

### Don't
*   **Don't** use 100% black (#000) or high-contrast grey borders. It breaks the "glass" illusion.
*   **Don't** use standard Material Design "Drop Shadows." They feel dated and "out-of-the-box."
*   **Don't** clutter the dashboard with too many primary green buttons. If everything is green, nothing is important. Use `primary` only for the "North Star" action of the page.