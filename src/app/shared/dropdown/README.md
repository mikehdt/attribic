# Dropdown Component

A flexible, accessible dropdown component with keyboard navigation support.

## Features

- Customisable styling for all parts of the dropdown
- Support for disabled options
- Keyboard navigation (arrow keys, Escape, Enter)
- Smart positioning to stay within viewport
- Fully accessible with ARIA attributes

## Usage

```tsx
import { Dropdown, DropdownItem } from '../path/to/shared/dropdown';

// Define your dropdown items
const items: DropdownItem<string>[] = [
  { value: 'option1', label: 'Option 1' },
  { value: 'option2', label: 'Option 2' },
  { value: 'option3', label: 'Option 3', disabled: true },
];

// In your component
const MyComponent = () => {
  const [selectedValue, setSelectedValue] = useState('option1');

  return (
    <Dropdown
      items={items}
      selectedValue={selectedValue}
      onChange={setSelectedValue}
      // Optional customisations:
      minMenuWidth="150px"
      icon={<MyIcon />}
      buttonClassName="custom-button"
      menuClassName="custom-menu"
    />
  );
};
```

## Props

| Prop                    | Type                                   | Description                        |
| ----------------------- | -------------------------------------- | ---------------------------------- |
| `items`                 | `DropdownItem<T>[]`                    | Array of dropdown items            |
| `selectedValue`         | `T`                                    | Currently selected value           |
| `onChange`              | `(value: T) => void`                   | Callback when selection changes    |
| `selectedValueRenderer` | `(item: DropdownItem<T>) => ReactNode` | Custom renderer for selected value |
| `className`             | `string`                               | Additional classes for container   |
| `buttonClassName`       | `string`                               | Classes for trigger button         |
| `menuClassName`         | `string`                               | Classes for dropdown menu          |
| `itemClassName`         | `string`                               | Classes for dropdown items         |
| `selectedItemClassName` | `string`                               | Classes for selected item          |
| `disabledItemClassName` | `string`                               | Classes for disabled items         |
| `minMenuWidth`          | `string`                               | Min width for dropdown menu        |
| `icon`                  | `ReactNode`                            | Icon to show in button             |
| `alignRight`            | `boolean`                              | Right-align the dropdown           |
| `openUpward`            | `boolean`                              | Open the dropdown upward           |

## DropdownButton

`<Dropdown>` is for picking a value from a list. When a control should _look_
like a dropdown but its popup holds custom content — a filter panel, a project
switcher, a settings sheet — use `<DropdownButton>`. It shares the trigger and
menu styling (`dropdown-styles.ts`) and the open/close wiring, and hands the
popup body a `close` callback:

```tsx
<DropdownButton label="Filter Assets" menuClassName="w-64">
  <VisibilityPanel />
</DropdownButton>

<DropdownButton label={projectLabel} menuClassName="min-w-72">
  {(close) => <ProjectPanel onClose={close} />}
</DropdownButton>
```

Children only render while the popup is open, so a panel component remounts —
and resets its local state — on each open. `size` and `variant` accept the same
values as `<Dropdown>`. Being a panel rather than a list, it carries no listbox
semantics or arrow-key navigation; the panel owns its own interaction model.
