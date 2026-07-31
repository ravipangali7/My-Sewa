# MySewa — Design System

Two portals. One product.

1. **User portal** — wallet app (mobile-first, native iOS look)
2. **Admin portal** — management dashboard (desktop-first web)

---

## Brand & Tokens

| Token | Value | Usage |
|---|---|---|
| `--brand` | `#0A7A4B` | Primary actions, success, brand mark |
| `--brand-dark` | `#065F3A` | Pressed / strong emphasis |
| `--brand-soft` | `#E8F6EF` | Soft fills, selected chips |
| `--bg` | `#F2F2F7` | iOS system grouped background |
| `--surface` | `#FFFFFF` | Cards / grouped lists |
| `--label` | `#1C1C1E` | Primary text |
| `--secondary` | `#8E8E93` | Secondary labels, captions |
| `--separator` | `#C6C6C8` | Hairline dividers |
| `--danger` | `#FF3B30` | Reject / failed / destructive |
| `--warning` | `#FF9500` | Pending |
| `--success` | `#34C759` | Approved / success |
| `--radius-lg` | `16px` | Grouped sections |
| `--radius-md` | `12px` | Buttons, inputs |
| `--radius-pill` | `999px` | Chips only when interactive |

**Typography (user portal):** SF Pro (system) — large title 34 / title 28 / headline 17 semibold / body 17 / footnote 13 / caption 12.  

**Typography (admin):** Same family; denser — page title 28, section 20, table body 14.

**Motion:** subtle spring on sheet present, 200ms fade on status chips, balance count-up on wallet home. Avoid decorative glow or purple themes.

---

# Portal A — User Portal (Wallet App)

**Platform feel:** Native iOS — large titles, grouped inset lists, bottom tab bar, system sheets, SF Symbols–style icons.

### Navigation (Tab Bar)

| Tab | Screen | Purpose |
|---|---|---|
| Home | Wallet home | Balance + quick actions |
| Services | Service hub | Top-up & bank transfer entry |
| History | Transactions | Deposits, top-ups, transfers |
| Profile | Account | Profile, security, settings |

### Screen Map

#### 1. Auth
- **Login** — phone + password; brand wordmark large at top; single primary CTA
- **Register** — phone, name, password; auto-creates wallet

#### 2. Wallet Home
- Large title: **MySewa**
- Balance block (not a floating card collage): amount in NPR, secondary “Available balance”
- Quick actions row (3 only): **Load** · **Top Up** · **Transfer**
- Recent activity (last 3–5), “See all” → History

#### 3. Load Wallet (Deposit / Remittance)
- Show company **QR** + **bank details** from Settings
- Amount field, optional note
- Upload screenshot proof (camera / gallery)
- Submit → status `pending`
- Status detail: pending (orange) / approved (green) / rejected (red)

#### 4. Mobile Top-Up
- Operator segmented control: **NTC** | **NCELL**
- Mobile number + amount
- Charge preview sheet (amount, charge, cashback, total debit)
- Confirm → pin/biometric if enabled → result screen

#### 5. Bank Transfer
- Bank picker (searchable list)
- Account number → **Verify** (shows account name)
- Amount + remarks
- Charge preview → confirm → result

#### 6. History
- Segmented: All | Load | Top-up | Transfer
- Inset grouped list rows: icon, title, amount (+/− color), status chip, time
- Tap → transaction detail (receipt-style)

#### 7. Profile
- Avatar, name, phone
- Edit profile, change phone, change password
- Logout (destructive)

### iOS Native Patterns (required)

- Large navigation titles that collapse on scroll
- Grouped `List` style sections with inset white blocks on `#F2F2F7`
- Bottom safe-area tab bar with SF Symbol–like icons
- Modal sheets for confirm / charge breakdown (grabber)
- System alerts for errors; haptic on success/fail where available
- Status bar + home indicator respected; 44pt min tap targets
- Pull-to-refresh on Home and History
- Empty states: simple illustration + one sentence + CTA

### Mobile Layout Rules

- First viewport of Home = brand + balance + 3 actions + recent list — nothing else
- No dashboard grids, no promo chips overlaid on hero balance
- Amounts always show `Rs.` / `NPR` consistently
- Credit amounts green, debit amounts primary label (or soft red for failed)
- One primary button per screen (green brand)

### Key User Flows (wireflow)

```
Home → Load → Enter amount + proof → Submitted (pending)
Home → Top Up → NTC/NCELL → Charge sheet → Success/Fail
Home → Transfer → Bank → Verify → Charge sheet → Success/Fail
History → Detail receipt
```

---

# Portal B — Admin Portal (Management)

**Platform feel:** Clean desktop web console. Dense tables, filters, clear status actions. Not a consumer wallet UI.

### Navigation (Sidebar)

| Section | Screens |
|---|---|
| Dashboard | Overview KPIs |
| Users | List, detail, activate/deactivate |
| Wallets | Balances, search by phone |
| Deposits | Pending queue, approve/reject |
| Top-ups | All NTC/NCELL transactions |
| Bank transfers | All outbound transfers |
| Settings | QR upload, bank details JSON/form |
| Admins | Staff accounts (superuser only) |

### Screen Specs

#### Dashboard
- KPI strip: total users, wallet float (sum of balances), pending deposits, today’s top-ups, today’s transfers
- Recent pending deposits table (quick approve path)

#### Users
- Table: phone, name, email, active, joined, wallet balance
- Detail: profile, wallet, linked deposits / top-ups / transfers

#### Deposits (critical queue)
- Default filter: `pending`
- Row: user phone, amount, screenshot thumbnail, note, created
- Actions: **Approve** (credits wallet) · **Reject**
- Bulk approve/reject supported (matches current Django admin actions)

#### Top-ups & Bank transfers
- Read-mostly ledgers: status, merchant txn id, provider ids, amounts, charge, total debited
- Filters: status, date range, operator/bank, phone search
- Detail drawer with raw `provider_response` for support

#### Settings
- Upload/replace QR image
- Edit bank details fields (bank name, account name, number, branch)
- Singleton — no delete

### Admin Visual Rules

- White content on light gray shell; brand green for primary buttons only
- Status badges: pending amber, approved/success green, rejected/failed red
- Tables first; avoid consumer-style cards for data
- Desktop ≥1280px comfortable; collapse sidebar on tablet

---

## Shared Components

| Component | User portal | Admin portal |
|---|---|---|
| Status chip | Soft pill, iOS colors | Compact badge |
| Amount | Large SF figures | Table numeric right-align |
| Empty state | Centered, soft | Inline table empty |
| Confirm | Bottom sheet | Modal dialog |
| Proof image | Full-bleed preview in sheet | Thumbnail + lightbox |

---

## Accessibility & Quality

- Contrast ≥ WCAG AA on text/icons
- VoiceOver-friendly labels on tabs and amounts
- Don’t rely on color alone for status — include text label
- Offline/error: clear retry on network failure after HimalPay calls

---

## Deliverable Checklist

**User portal**
- [ ] iOS-like tab shell + large titles
- [ ] Wallet home with Load / Top Up / Transfer
- [ ] Deposit flow with QR + proof upload
- [ ] NTC & NCELL top-up with charge sheet
- [ ] Bank transfer with verify + charge sheet
- [ ] History + detail receipts
- [ ] Profile & security

**Admin portal**
- [ ] Dashboard KPIs
- [ ] Deposit approval queue
- [ ] Users & wallets
- [ ] Top-up & transfer ledgers
- [ ] Settings (QR + bank details)
