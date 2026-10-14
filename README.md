# Event Command

Operations dashboard for an event IT team: radios, inventory, purchasing, accommodation, manpower, meetings and one
approval flow for everything people ask for. Next.js + React + Tailwind + Supabase.

```
npm install
cp .env.example .env.local     # add your Supabase URL and publishable key
npm run dev
```

## Who can do what

```
Organization Head (owner)
  └─ IT Department Head
       └─ Sub-department Head   (CCTV, WiFi, Walkie-Talkie, Control Rooms, Inventory, Purchase, Accommodation, Manpower)
            └─ Staff
```

New people sign up with their department's **sign-up code**, then the Organization Head approves them
(**Users & Access**). Roles can be changed there too; the database refuses anyone else.

For a one-click demo login screen, create the demo users in Supabase Auth, then set these optional values in
`.env`. The login page shows a shortcut for each configured account and still signs in through Supabase.
Use disposable demo accounts only: frontend environment values are visible to users of the deployed app.
Map Super Admin to Organization Head, IT Admin to IT Department Head, and the other two accounts to their
chosen sub-department heads in **Users & Access**.

```
NEXT_PUBLIC_DEMO_SUPER_ADMIN_EMAIL=
NEXT_PUBLIC_DEMO_SUPER_ADMIN_PASSWORD=
NEXT_PUBLIC_DEMO_IT_ADMIN_EMAIL=
NEXT_PUBLIC_DEMO_IT_ADMIN_PASSWORD=
NEXT_PUBLIC_DEMO_DEPT_ADMIN_1_EMAIL=
NEXT_PUBLIC_DEMO_DEPT_ADMIN_1_PASSWORD=
NEXT_PUBLIC_DEMO_DEPT_ADMIN_2_EMAIL=
NEXT_PUBLIC_DEMO_DEPT_ADMIN_2_PASSWORD=
```

## The request flow

Any department asks for what it needs. It never sees stock.

1. **Request** – item, quantity, why, deliver-to, needed-by. Radios are a separate line type.
2. **Department head** – approves (sent on) or rejects with a reason. Heads and the owner skip this step.
3. **Owner** – sees the reason and sets the **approved quantity per line** (never above what was asked), or rejects.
4. **Arrange** – the Inventory team (or Walkie-Talkie team for radios) splits each approved line: *from stock*,
   *to purchase*, or both. Stock is reserved only at this point.
5. **Purchase** – creates one purchase order from everything marked "to purchase". It is already approved
   (the owner approved the request), so it needs no second approval. Receiving goods books them into inventory.
6. **Hand over** – Inventory issues from stock to the delivery location; Walkie confirms radios.
   When every approved line is delivered the request closes and the requester is notified.

Every request has a detail page (status, items asked / approved / how provided, comments, full timeline) that prints
cleanly and can be shared as a **read-only link** (`#/r/<token>`), which the requester or owner can switch off.
Everything that happens is also written to the Audit log.

## What is live and what is demo

| Live (Supabase) | Demo data (this browser only) |
|---|---|
| CCTV camera inventory, Wi-Fi access point inventory, event-linked Wi-Fi access register and usage reports, Walkie, Accommodation member profiles/rooms/meals, Manpower and team tasks, Inventory, Purchase, **Requests**, Meetings and Emergencies, Notifications, Access and sign-up codes, Audit log, Reports, Payments overview | Control Rooms (browser-only demo data) |

## Project layout

```
src/
  app/                      Next.js App Router entry and root layout
  App.tsx                   routes, providers, shell (+ the public share route)
  context/                  AppContext (signed-in user + Control Rooms demo data), AccessContext, MeetingsContext
  components/ui.tsx         shared UI kit: Card, Pill, Field, Tabs, Stat, buttons, inputs
  components/owner/         Approvals, Users & Access, Audit log, Reports
  views/                    Dashboard (Home), Meetings, Payments & Approvals
  modules/
    requests/               the request flow (context, form, detail page, approval + arrange panels, share page)
    inventory/ purchase/ accommodation/ manpower/ walkie/
supabase/                   SQL: run in order, see supabase/README.md
```

## Setup order for a new database

For a new database, run `supabase/setup.sql` once. For an existing database,
apply only the migrations it is missing, in numeric order. Full steps are in
[`supabase/README.md`](supabase/README.md).

## Conventions

- Colors and sizes come from the Tailwind tokens (`bg-surface`, `text-ink`, `text-mute`, `border-line`, `text-xs/sm/base`).
  Do not hardcode pixel font sizes. The `violet / purple / cyan / indigo / sky` classes are old aliases of the same blue; use `blue-*`.
- New shared UI goes in `components/ui.tsx`. Every screen imports from there.
- Anything that changes data goes through a database function or a policy-checked table; never trust the screen to enforce a rule.
