# UI facade contracts

The executable contract registry is `packages/ui/src/contracts.js`. It records stable semantic props, events, slots, states, and accessibility behavior for each approved component. Application code must not depend on PrimeVue prop names.

All interactive controls retain a 44 px minimum target, visible focus, keyboard operation, reduced-motion behavior, and usable layouts at 200% zoom. Dialog and drawer focus trapping and focus return are delegated to the wrapped PrimeVue accessibility implementation and covered again in route E2E tests when those controls enter user flows.

Form facades that render a nested native control expose `inputId`; pair it with `AppField.inputId` so the visible label, validation message, and accessible control name stay connected across vendor components.

Loading, empty, error, validation, disabled, and responsive states apply where the registry names them. Feature stories add visual and interaction cases using those stable semantics rather than expanding the vendor surface.
