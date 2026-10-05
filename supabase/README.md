# Backend Setup — Supabase

Your app runs on a real backend (Postgres database + Auth + live sync)
instead of the browser's `localStorage`. That means:

- Data is safe if you clear your browser cache, switch browsers, or get a new device.
- Multiple people can use the app at the same time and see each other's changes live.
- Login is enforced server-side (not just hidden in the frontend code).

Everything below is a one-time setup. Takes about 15 minutes.

---

## 1. Create a free Supabase project

1. Go to https://supabase.com and sign up (free tier is enough for this app).
2. Click **New Project**. Pick any name/region, set a database password (save it somewhere).
3. Wait ~2 minutes for the project to finish provisioning.

## 2. Run the database schema

1. In your Supabase project, open **SQL Editor** (left sidebar).
2. Click **New query**.
3. Open `supabase/schema.sql` from this project, copy the whole file, paste it into the editor, click **Run**.
4. Click **New query** again, open `supabase/auth_hardening.sql`, copy the whole
   file, paste it in, and **Run** it too.
5. Then run these, one at a time, in this order (every one can be re-run safely):

   | File | Adds |
   |---|---|
   | `migration_v2_deliveries.sql` | delivery details for radios |
   | `migration_v3_organizations.sql` | organizations (multi-tenant) |
   | `migration_v4_hierarchy.sql` | owner → IT head → sub-department → staff |
   | `migration_v5_accessories.sql` | radio accessories |
   | `migration_v6_backend_fixes.sql` | accessory columns, unique serials/channels, realtime, schema reload |
   | `migration_v7_accommodation.sql` | Accommodation rooms, members, live meal menu |
   | `migration_v8_menu_owner.sql`, `migration_v9_custom_meals.sql` | menu owner, custom meals |
   | `migration_v10_manpower.sql` | Manpower (sewadars) |
   | `migration_v11_inventory.sql`, `migration_v12_inventory_crud.sql`, `migration_v13_inventory_locations.sql` | Inventory, categories, locations |
   | `migration_v14_purchase.sql` | Purchase orders, vendors, receipts, payments |
   | `migration_v15_access_meetings.sql` | sign-up codes, access approval, meetings, notifications |
   | `migration_v16_requests.sql` | **Requests flow** (request → dept head → owner → stock / purchase), share links, stock reservation, meeting-status check |
   | `migration_v17_requests_v2.sql`–`migration_v19_procurement.sql` | Request refinements and unified procurement approvals |
   | `migration_v20_manpower_tasks.sql` | Shared team task board linked to manpower records |
   | `migration_v21_wifi_access.sql` | Wi-Fi credential register with recipient scoped access |
   | `migration_v22_accommodation_roster.sql` | Full accommodation member profiles and CSV import |
   | `migration_v23_meal_label_repair.sql` | Repair `meal_label` when v9 was missed on an existing database |
   | `migration_v24_member_operations.sql`–`migration_v26_shared_member_roster.sql` | Member operations, member types, and shared roster |
   | `migration_v27_cctv_wifi_assets.sql` | CCTV/WiFi asset registers |
   | `migration_v28_request_it_owner_approval.sql` | Request approvals: branch head → IT owner → organization owner; refreshes open requests into the IT review queue |
   | `migration_v29_meeting_minutes.sql` | Meeting minutes stored with each meeting and organizer/owner edit permission |

   `migration_v16` needs v11–v15 first (it reads inventory, purchase, notifications and the history table).
6. Accommodation permissions (set in the app under **Settings -> Team & Users ->
   Access level**, or with SQL — see the bottom of `migration_v7_accommodation.sql`):
   - **Owner** can add/edit/delete rooms and members and move people between rooms.
   - **Sub-dept head + Accommodation** can edit the meal menu and the live status.
   - Everyone else who is signed in can view both.

`schema.sql` creates all 6 tables (`profiles`, `departments`, `walkies`,
`allocations`, `maintenance`, `history`), sets up baseline security rules,
turns on live sync, and seeds demo data.

`auth_hardening.sql` upgrades the auth setup for real sign-ups and password
resets — it also **fixes two privilege-escalation bugs** that existed in the
original schema (a signed-up user could set their own role to `Admin`, and
`raw_user_meta_data` sent from the browser was trusted for role assignment).
Run it even on a project that already has `schema.sql` applied.

## 3. Get your API keys

1. In Supabase: **Settings** → **API**.
2. Copy the **Project URL** and the **anon / public key**.
3. In this project's root folder, copy `.env.example` to a new file named `.env`.
4. Paste in your values:
   ```
   REACT_APP_SUPABASE_URL=https://your-project-ref.supabase.co
   REACT_APP_SUPABASE_ANON_KEY=your-anon-key
   ```
5. Never share the **service_role** key or commit `.env` to git — the `.gitignore` already excludes it.

## 4. Configure Auth URLs (needed for password reset emails to work)

1. In Supabase: **Authentication** → **URL Configuration**.
2. Set **Site URL** to your app's URL (e.g. `http://localhost:3000` for local
   dev, or your deployed URL in production).
3. Under **Redirect URLs**, add:
   - `http://localhost:3000/` (for local dev)
   - `https://your-deployed-domain.com/` (for production, once deployed)

The app redirects the password-reset link back to the site root and reads
the recovery token from the URL hash, so no extra path (like
`/reset-password`) needs to be whitelisted — this also avoids needing a
server-side rewrite rule on static hosts.

## 5. Decide on email verification

1. In Supabase: **Authentication** → **Providers** → **Email**.
2. **"Confirm email" ON** (recommended): new sign-ups must click a
   verification link before they can log in. The app already shows a
   "check your email" message and a resend button for this case.
3. **"Confirm email" OFF**: fine for a small internal/trusted team — new
   accounts can sign in immediately after signing up.

## 6. Create the Organization Head (owner)

Choose **New Organization** on the sign-up screen. The person who creates an organization becomes its
**Organization Head** (owner) and is approved straight away. Everyone else joins with a **sign-up code**:

1. Owner: open **Users & Access → Sign-up codes** and give each department its code.
2. A new person signs up with that code and waits on the "Waiting for approval" screen.
3. Owner: **Users & Access → Access requests** → pick the role (Staff, Sub-department head, IT department head)
   and the department → **Approve**. The decision is saved in the database and the person is notified.
4. Roles can be changed later under **Users & Access → People**.

If an older organization has an Admin but no owner, `migration_v15` promotes that Admin to owner.
Only the owner can approve access, approve requests, and change roles; the database enforces this (not only the screens).

## 7. Install and run

```bash
npm install
npm start
```

That's it — the app now reads/writes to your Supabase database, and any
change made by one signed-in user shows up live for everyone else.

---

### FAQ

**Do I need to keep paying for anything?**
No — Supabase's free tier covers this comfortably for a small team (500MB
database, 50k monthly active users, 2GB file storage, unlimited API requests
within fair use).

**What if I want to deploy this so it's not just on my laptop?**
Build the app (`npm run build`) and host the `build/` folder on any static
host (Netlify, Vercel, Cloudflare Pages, GitHub Pages, etc.). The Supabase
backend is already cloud-hosted, so the frontend can live anywhere. Remember
to add the deployed URL to Redirect URLs (step 4) too.

**Can I still use it offline / without Supabase?**
Not with this version — it now requires a Supabase connection to load data.
If you ever want a hybrid (offline-first with sync), that's a separate,
bigger change — just ask.

**How do I fully delete a user, not just disable them?**
Disabling (from the Users tab) immediately blocks sign-in and is enough for
almost everyone. Deleting the underlying Supabase Auth account requires the
`service_role` key, which intentionally never lives in the frontend — do
that from **Authentication** → **Users** → delete, in the Supabase dashboard.

**Something's not loading / blank screen.**
Open the browser console (F12). The most common cause is a missing or wrong
`.env` file — the app logs a clear error for that. Make sure you restarted
`npm start` after creating `.env` (env vars are only read at startup).

---

## Inventory & Purchase migrations (run in this order, after v7)

| File | What it adds |
|------|--------------|
| `migration_v11_inventory.sql` | Inventory items + stock ledger |
| `migration_v12_inventory_crud.sql` | Editable categories |
| `migration_v13_inventory_locations.sql` | Stock is issued to a **location** (Gate 3, Main Stage...), not a department. Every movement records **given by / received by / returned by**. Old department data is converted automatically. |
| `migration_v14_purchase.sql` | Vendors, purchase orders, goods received, payments |

All of them can be re-run safely.

**Inventory movements**
- *Issue*: send stock to a location. Given by (store person), Received by (person at the location, required).
- *Return*: bring stock back from a location. Returned by (required), Received by (store).
- *Receive*: new stock into the store. Received from (vendor), Received by.

**Purchase permissions**
- View: owner, IT head, Purchase and Inventory sub-department.
- Create / edit orders, vendors, payments: owner, IT head, Purchase sub-department.
- Approve / reject: owner and IT head only.
- Receive goods: the above + Inventory sub-department.

**Purchase order life:** draft -> awaiting approval -> approved -> ordered -> partly received -> received.
When goods are received against an order line that is linked to an inventory item, the stock is added to Inventory
automatically (a "receive" entry with the PO number as reference).


## migration_v17_requests_v2.sql
Run after v16. Requests v2: a reason on every line, catalogue item picker (`catalogue_list`), owner reason for every reduced
line, richer approval notification, "arrived" and per-delivery notifications, requester confirms receipt, owner-controlled
vendor/rate visibility (`request_set_visibility`, `request_order_info`), and the public share link is removed.

## migration_v18_requests_fixes.sql
Run after v17. Fixes `record "f" is not assigned yet` when creating a purchase order from a request, adds unlisted items to the
catalogue automatically when they are bought, and stops a line that is already on a purchase order from being re-split.

## migration_v19_procurement.sql
Run after v18. Requests, Purchase and Payments become one flow: orders are built from the buy list (several tickets per
order), the owner approves every order and every payment, Purchase asks for a payment, the owner approves, Purchase pays.
No stand-alone orders. Payment data is visible to the owner, IT head and Purchase team only.

## migration_v20_manpower_tasks.sql
Adds the shared manpower task board: managers assign work to a sewadar or team, and the assignee moves it from to-do to in progress to complete. The owner/IT head can see ongoing work from the command overview. This migration assumes the organization and profile helpers from v3/v4 and the manpower tables from v10.

## migration_v21_wifi_access.sql
Adds Wi-Fi credential issue tracking with network/location, login, password, department, recipient, and expiry. Owners, IT heads, and Wi-Fi managers can manage the register. Other users can only read a credential whose recipient email matches their signed-in account. Passwords are stored in the database so authorized staff can retrieve them; restrict database project access accordingly.

## migration_v22_accommodation_roster.sql
Adds member category, batch/serial, relation, phone, address, branch, occupation, joining date and employee fields used by Rooms & Members CSV import. The importer accepts volunteer and employee style headers and can link a room by room name.

## migration_v23_meal_label_repair.sql
If the app reports that `meal_menu.meal_label` is missing, run this repair in the Supabase SQL Editor. It safely adds the column, fills existing labels from their meal keys, and asks PostgREST to reload its schema cache. It does not recreate or modify existing menus.

## migration_v24_member_operations.sql
Run after v22. Adds member call outcomes/count and timestamp, expected arrival, arrival status, team and team lead fields, plus a member-linked task board. Tasks can be assigned to a roster member, progressed through to-do / in progress / complete, and are also shown in the Manpower team task panel.

## migration_v25_member_types.sql
Run after v22. Migrates the old `permanent` category to `salary_based`, updates the database default, and restricts member types to salary-based, monthly, or annual.

## migration_v28_request_it_owner_approval.sql
Run after migrations v16–v19. Requests move through the branch head when one is configured, then the IT department owner, then the organization owner for final approval. Once approved, the existing Inventory and Walkie request inboxes receive only their relevant requirements. The migration adds the IT review note and routes existing open owner-pending requests through the missing IT approval step.

## migration_v29_meeting_minutes.sql
Run after migration_v15. Adds a minutes field to each meeting and a secured save function. The organizer, IT owner, or organization owner can save or edit the meeting minutes.

## migration_v30_member_shift.sql
Adds the Night/Morning shift field to the shared Accommodation and Sewadars member roster. Run it in the Supabase SQL Editor before using the new field.

## migration_v31_meeting_audience_groups.sql
Adds targeted audiences for meetings and emergency calls: IT staff, Regular and Annual Sewadars, all Sewadars, or every existing Sewadar team. It also lets the organization owner link a portal account to a Sewadar roster member so each selected member receives portal notifications. Run after v15, v24, v26, v29, and v30.

## migration_v32_member_issue_reports.sql
Adds a portal form for material problems and site/event complaints, private member report history, team issue inbox access, and status notifications. Run after migration_v15_access_meetings.sql.
