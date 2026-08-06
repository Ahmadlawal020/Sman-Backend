# Order Reference Format

## Overview

All applications (Soroman App, SoomanFE, Soroman Frontend) must use a standardized order reference format generated from the backend.

**Format:** `INITIALS/ORDER_ID`

## Components

### Initials (2 letters max)

Extracted from the customer's company name:

- **Multiple words:** First letter of each word (2 letters max)
  - Example: "Honeywell Adada" → `HA`
  - Example: "Shell Petroleum Nigeria" → `SP`
  
- **Single word:** First 2 letters
  - Example: "Soroman" → `SO`
  - Example: "Dangote" → `DA`

- **No company name:** Default to `SO` (Soroman)

### Order ID

The order ID from `OrderPaymentInfo` or `Order` table.

## Examples

| Company Name | Order ID | Reference |
|---|---|---|
| Honeywell Adada | 10831 | `HA/10831` |
| Shell Petroleum Nigeria | 5432 | `SP/5432` |
| Soroman | 1000 | `SO/1000` |
| Dangote | 500 | `DA/500` |
| (null/empty) | 999 | `SO/999` |

## Implementation

### Backend (Node.js/Express)

```javascript
const { generateOrderReference } = require("../utils/helpers");

// Generate reference dynamically
const reference = generateOrderReference(customer.companyName, order.id);
// → "HA/10831"
```

### Frontend (React/Vue)

```javascript
// Import from backend API or utility
import { generateOrderReference } from "@/utils/orderHelper";

const reference = generateOrderReference(customer.companyName, order.id);
```

## Important Notes

1. **Dynamic Generation:** The reference is generated on-demand from customer + order data, NOT stored as a field in the database.

2. **Consistency:** Use the same logic across all applications to ensure identical references everywhere.

3. **No Storage:** Do not save the reference as a separate column—compute it when needed.

4. **Case Handling:** Company names are normalized to uppercase initials regardless of input case.

## Testing

Run the test suite:

```bash
npm test -- tests/order-reference.test.js
```

All edge cases are covered, including:
- Multiple-word company names
- Single-word company names
- Empty/null company names
- Extra whitespace
- Numeric and string order IDs
