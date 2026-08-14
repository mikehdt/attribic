# Checkbox Component

A reusable checkbox component with custom styling that matches the application's design system.

## Features

- Custom styled checkbox with Tailwind CSS
- Keyboard accessibility (tab navigation and Enter/Space to toggle)
- Visual feedback for hover and checked states
- Support for disabled state
- ARIA attributes for accessibility

## Usage

```tsx
import { Checkbox } from '../path/to/shared/checkbox';

// Basic usage
<Checkbox
  isSelected={isSelected}
  onChange={() => setIsSelected(!isSelected)}
/>

// With custom class and disabled state
<Checkbox
  isSelected={isSelected}
  onChange={handleChange}
  className="my-custom-class"
  disabled={true}
  ariaLabel="Select item"
/>
```

## Props

| Prop             | Type                 | Description                                                       |
| ---------------- | -------------------- | ----------------------------------------------------------------- |
| `isSelected`     | `boolean`            | Whether the checkbox is selected/checked                          |
| `onChange`       | `() => void`         | Function to call when the selection changes                       |
| `className`      | `string` (optional)  | Additional classes to apply to the checkbox                       |
| `tabIndex`       | `number` (optional)  | Tab index for keyboard navigation (defaults to 0)                 |
| `disabled`       | `boolean` (optional) | Whether the checkbox is disabled                                  |
| `ariaLabel`      | `string` (optional)  | Aria label for accessibility                                      |
| `isSoftSelected` | `boolean` (optional) | Half-ticked: counted without being chosen outright (`aria-mixed`) |
