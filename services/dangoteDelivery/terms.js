// The Dangote Delivery Terms & Conditions, served to the portal and stamped
// (by version) into every signature. Source of truth moved here from the
// frontend's lib/dangote-delivery/terms.ts — keep the two in sync until the
// frontend switches to GET /terms, then this is the only copy.

const TERMS_VERSION = "1.0";
const TERMS_TITLE = "Soroman Terms & Conditions";
const TERMS_EFFECTIVE = "Effective 1 July 2026";

const TERMS_SECTIONS = [
  {
    heading: "1. The agreement",
    body: "These terms govern the purchase of bulk Premium Motor Spirit (PMS, “petrol”), Automotive Gas Oil (AGO, “diesel”), and Liquefied Petroleum Gas (LPG) from Soroman Nigeria Limited under the Dangote Delivery programme. By accepting these terms, the customer enters a sub-dealer agreement for the order described in the accompanying schedule.",
  },
  {
    heading: "2. Pricing and payment",
    body: "The order is submitted as a quote request. After the Soroman team verifies the customer's documents, Soroman issues a firm quote — quantity multiplied by the quoted unit price. The quoted amount is payable before dispatch, from the customer's Soroman wallet or by transfer to the customer's dedicated virtual account.",
  },
  {
    heading: "3. Documentation and verification",
    body: "The customer must provide a valid DPR/NUPRC operating license. The Soroman team verifies all documents before issuing a quote. Soroman may reject any request that fails verification; because payment is only collected after approval, no charge is made for a rejected request.",
  },
  {
    heading: "4. Delivery",
    body: "Deliveries are scheduled after approval and are made to the address stated in the order schedule. The customer must ensure the delivery site is accessible and compliant with applicable safety regulations for the receipt of bulk petrol.",
  },
  {
    heading: "5. Licenses and compliance",
    body: "The customer warrants that its operating licenses remain valid through the delivery date. If a verified license expires before dispatch, the order is suspended until a current license is provided.",
  },
  {
    heading: "6. Cancellation",
    body: "The customer may cancel a request at any point before payment, including while it is under review or after a quote has been issued. Orders cannot be cancelled once paid; a request that fails verification is never charged.",
  },
  {
    heading: "7. Acceptance",
    body: "Checking the acceptance box, together with the recorded timestamp and device information, constitutes the customer's acceptance of these terms and carries the same effect as a handwritten signature.",
  },
  {
    heading: "8. Liability",
    body: "Soroman's aggregate liability under an order is limited to the amount paid for that order. Nothing in these terms limits liability that cannot be limited under applicable law.",
  },
];

module.exports = { TERMS_VERSION, TERMS_TITLE, TERMS_EFFECTIVE, TERMS_SECTIONS };
