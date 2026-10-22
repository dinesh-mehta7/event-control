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

## 2. Set up the database

### New Supabase project

For a fresh database, run **one file**:

1. In your Supabase project, open **SQL Editor** and click **New query**.
2. Open `supabase/setup.sql`, copy the whole file into the editor, and click **Run**.

`setup.sql` contains the base schema, auth hardening, and the current migrations in
the required order through migration v110. This is the easiest path for a new project.

### Existing Supabase project

Do **not** run `setup.sql` on an existing project. Keep its data and apply only
the migration files it has not received yet, in version order. Each migration
file remains available below as the upgrade history; migration v16 needs v11–v15
first.

## Meeting invitations and request escalation emails

The meeting scheduler can open a prefilled Google Calendar or Outlook event
composer. When Teams is selected and Microsoft Graph is connected, the app can
create the Teams meeting automatically. When Microsoft Graph is connected, scheduling also
creates a busy event in the configured Outlook calendar and sends calendar
invitations to the selected audience, booking the chosen one-hour slot. Without
Graph, invite emails contain an `.ics` file that recipients can add themselves.
Portal notifications continue to be created by the database.

To enable email delivery:

1. Create a free Resend account and verify a sending domain. Resend's free
   transactional tier currently allows up to 3,000 emails per month and 100 per
   day; those caps apply to all meeting and escalation emails.
2. Deploy the function: `supabase functions deploy workflow-email`.
3. Add these secrets in Supabase **Project Settings → Edge Functions → Secrets**:
   `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (for example,
   `Event Command Center <notifications@your-verified-domain>`), and
   `APP_BASE_URL` (the deployed app URL).
4. To automatically create Teams meetings, reserve Outlook calendar time, and send attendee invitations,
   register an app in Microsoft Entra ID, grant the **Microsoft Graph application
   permissions** `Calendars.ReadWrite` and `OnlineMeetings.ReadWrite.All`, and grant admin consent. For Teams online meetings, configure a Teams application access policy for the dedicated organizer mailbox and grant that policy to the mailbox. Restrict the app's
   mailbox access to the dedicated meeting calendar/mailbox where possible. Add
   these Edge Function secrets:
   `OUTLOOK_TENANT_ID`, `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, and
   `OUTLOOK_CALENDAR_USER` (the mailbox email address or user principal name).
   The application-permission flow requires a Microsoft 365 work/school tenant
   and an admin to grant consent; personal Outlook.com accounts need a different
   delegated OAuth setup. The configured `OUTLOOK_CALENDAR_USER` is also the Teams
   meeting organizer. If the meeting is online, Teams is selected, and no join
   link was pasted, the function creates a Teams meeting and saves its join link
   before emailing invitees. A pasted link is used as-is.

5. To generate minutes from Teams transcripts when an organizer marks a meeting
   done, add the Graph application permission `OnlineMeetingTranscript.Read.All`
   and grant admin consent. Keep the Teams application access policy in place,
   and ensure the Microsoft 365 tenant permits Graph transcript access. Add
   `OPENAI_API_KEY` to Supabase Edge Function secrets; optionally set
   `OPENAI_MINUTES_MODEL` to choose the model. Apply
   `supabase/migration_v77_meeting_transcripts.sql` to existing databases and
   deploy `workflow-email`. Teams transcription must be enabled for the meeting.
   Minutes are generated from the transcript and saved in the existing minutes
   field. Transcript text is sent to the OpenAI API for summarization. If the
   transcript is not available when the organizer marks the meeting done, the
   app displays the reason and provides a retry action on that meeting.

The function emails invited portal accounts from the meeting's selected
audience. With Graph connected it also writes the meeting into the configured
Outlook calendar as busy and invites attendees. When the IT Department Head
escalates a request, it emails all active Super Admin accounts in the
organization. If calendar or email delivery is not configured or fails, the app
reports that the in-app action succeeded and identifies the delivery issue.

Google Meet and other provider links must still be created by the organizer and
pasted into the app. Teams links can be created automatically when Graph and
the Teams application access policy are configured. Microsoft Graph uses the
configured service mailbox to book the Outlook calendar slot and send attendee
invitations.

The migration inventory is:

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
   | `migration_v30_member_shift.sql`–`migration_v65_permanent_member_holidays.sql` | Member scheduling, event planning, radio requests, request workflows, delivery tracking, vendor purchasing, and roster updates (apply every missing version in order) |
   | `migration_v66_team_task_priority.sql` | Team task priority and optional priority deadline |
   | `migration_v67_task_resource_handoffs.sql` | Issue inventory tools/material to task team leaders and track good/damaged returns |
   | `migration_v68_department_feedback_updates.sql` | Department-scoped feedback, announcements, and lessons learned for the Issues & Reports Administration page |
   | `migration_v69_accommodation_room_categories.sql` | Adds Rest room and Control room categories and assigns Control room setup requirements to a Sewadar team |
   | `migration_v70_task_completion_notifications.sql` | Sends task completion notifications to the task creator's notification bell |
   | `migration_v71_remove_food_ready_for_event.sql` | Removes Ready for event from Food and returns existing meals in that state to In preparation |
   | `migration_v72_general_feedback.sql` | Combines material/site-event reports as Issues and adds a separate general Feedback option |
   | `migration_v73_event_linked_reports.sql` | Links Issues & Reports entries to an event |
   | `migration_v74_wifi_event_usage.sql` | Associates Wi-Fi access issues with events for usage reports |
   | `migration_v78_event_staffing_requirements.sql` | Daily event staffing requirements and collection locations |
   | `migration_v79_event_room_requirements.sql` | Event room requirements synced to Accommodation |
   | `migration_v80_wifi_register_fields.sql` | Switch and port details for outdoor Wi-Fi points, plus department user ID issue list fields |
   | `migration_v81_accounts_vendor_payment_docs.sql` | Accounts-only vendor payments and optional bill/payment proof attachments |
   | `migration_v82_event_radio_collection_unit.sql` | Required source unit for event Walkie-Talkie requests |
   | `migration_v83_manpower_task_assignment_access.sql` | Aligns task, Sewadar assignment, and resource permissions with the Sewadar and Accommodation workspaces |
   | `migration_v84_task_team_links.sql`–`migration_v89_helpdesk_spiceworks.sql` | Task team links and resource reservations, duties and shifts, Help Desk, event collection source fields, and Help Desk asset/task/technician features |
   | `migration_v90_role_hierarchy.sql`–`migration_v97_sub_department_rename_hide.sql` | Department-aware role hierarchy and access, permission modules, organization join hardening, organization profile/member management, custom sub-departments, and rename/hide controls |
   | `migration_v98_request_review_by_own_department_head.sql`–`migration_v100_department_sub_departments.sql` | Department-specific request review, membership, and sub-department configuration |
   | `migration_v101_department_stocks.sql`–`migration_v104_offline_order_status.sql` | Department-scoped inventory/procurement and people/tasks/events, request origin department, and offline order progress |
   | `migration_v105_helpdesk_issues_to_department.sql`–`migration_v109_order_only_by_approving_department.sql` | Department-scoped Help Desk/reports and staffing, request department repairs, and department-scoped approvals and ordering |
   | `migration_v110_request_purchase_department_fix.sql` | Keeps purchase catalogue references in the request department and applies the stock department guard only to stock fulfilments |

`migration_v16` needs v11–v15 first (it reads inventory, purchase, notifications and the history table).

Accommodation permissions (set in the app under **Settings -> Team & Users ->
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
3. In this project's root folder, copy `.env.example` to `.env.local`.
4. Paste in your values:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
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

## migration_v36_department_admin_arrangement.sql
Run after migrations v16–v19. Restricts request source decisions (stock, purchase, or Walkie pool) to the Super Admin and Department Admin. Sector teams can still carry out delivery, and purchase allocations continue into the shared Procurement buy list.

## migration_v37_request_admin_budget_departments.sql
Run after migration_v36. New requests go first to the Department Admin, who can approve with a per-unit budget, reject, or escalate to the Super Admin. Escalated requests retain the Super Admin's quantity and budget review. Requests store the selected department ID from the Walkie Departments list, so department names and channel numbers stay synced.

## migration_v38_walkie_serial_optional.sql
Run after the Walkie schema migrations. Walkie serial numbers are no longer collected or displayed; this makes the database field optional and removes its uniqueness constraint. Existing serial values remain stored for legacy records.

## migration_v39_request_arrangement_returns.sql
Requesters choose whether each item is returned after use or purchased to keep. This migration adds the return and inventory-arrangement support; migration v40 defines the saved approval plan and budget behavior used by the current request flow.

## migration_v40_request_review_plan.sql
Department Admins review requests, set approved quantities, unit item budgets and an optional miscellaneous addition, and prepare the inventory/purchase plan. The saved plan can be approved directly or escalated unchanged to Super Admin. Approval reserves inventory and routes purchase quantities to Procurement.

## migration_v41_request_routing_to_it_admin.sql
All requests go to the IT Department Head for review, regardless of the selected department. The selected department remains attached to the request for reporting and fulfilment. Run after migration_v40_request_review_plan.sql.

## migration_v42_request_misc_items.sql
Adds a miscellaneous item description next to the IT Department Head's miscellaneous budget addition. The description and amount are saved with the review plan and shown in request details and exports. Run after migration_v41_request_routing_to_it_admin.sql.

## migration_v43_fix_cross_department_request_review.sql
Fixes request review so the IT Department Head can review requests from any selected department. The request keeps its originating department for reporting and fulfilment; all active IT Department Heads receive review notifications. Run after migrations v41 and v42.

## migration_v44_require_arrangement_before_escalation.sql
Requires the IT Department Head to confirm the stock quantity for each approved item before approval or escalation. Enter 0 to confirm the item should be purchased in full. Super Admin receives the saved budget and arrangement plan for final approval. Run after migration_v43_fix_cross_department_request_review.sql.

## migration_v45_super_admin_three_actions.sql
Limits Super Admin request review to Approve, Send back, or Reject. Approval commits the IT Department Head's saved review plan without requesting another decision.

## migration_v46_request_delivery_tasks.sql
Run after migration_v45_super_admin_three_actions.sql. The IT Department Head assigns delivery to a Sewadar team or IT Sewadar while reviewing the request. Approval creates delivery tasks for stock and Walkie items; purchased item tasks appear after Procurement records those goods as received. Completing a linked task records the handover on the request and issues inventory stock from the selected store location.

## migration_v47_purchase_delivery_tracking.sql
Adds shipment tracking records to purchase orders. Purchase staff can connect an Amazon, Flipkart, or other marketplace order using its carrier tracking number; AfterShip webhook events update the order and request screens automatically. Received goods are added to Inventory, creating a catalogue entry if needed. Deploy `aftership-register-tracking` and `aftership-webhook` with the Supabase CLI, add `AFTERSHIP_API_KEY` and `AFTERSHIP_WEBHOOK_SECRET` under Supabase Edge Function secrets, then configure AfterShip to post webhooks to `https://<project-ref>.supabase.co/functions/v1/aftership-webhook`. Marketplace order numbers alone do not provide carrier scans; a carrier tracking number is needed.

## migration_v48_assign_delivery_after_approval.sql
Moves delivery assignment to after final approval. The IT Department Head can assign an approved request to a team or IT Sewadar; stock delivery tasks are created immediately, while purchased-item tasks are created once the goods are received. Apply after migration_v47.

## migration_v49_procurement_no_owner_order_approval.sql
Separates Procurement into its own sidebar workspace and removes post-request Super Admin approval queues. Purchase enters vendor/rate details, places the order manually, then records it as ordered; payment requests become ready to pay directly. Shipment tracking and receiving continue in Procurement. Apply after migration_v48.

## migration_v50_fix_delivery_assignment.sql
Fixes delivery task assignment failing on a PL/pgSQL record/alias name collision. Apply after migration_v49.

## migration_v51_vendor_order_mode.sql
Adds an Online/Offline mode to purchase orders. Online placed orders expose marketplace delivery tracking; offline orders do not. Existing placed orders keep tracking available. Apply after migration_v50.

## migration_v52_vendor_categories.sql
Adds an Online/Offline category to each vendor. Procurement order mode follows the selected vendor's category. Existing vendors remain uncategorized until edited. Apply after migration_v51.

## migration_v54_order_tracking_stage.sql
Adds staged online-order tracking and IT Department Head notifications. Purchase can save an order ID before dispatch, then attach the courier AWB later for AfterShip status updates. Notifications are sent when the order is saved, courier tracking starts, and delivery status/checkpoints change. Apply after migration_v52. Deploy `aftership-register-tracking` and `aftership-webhook`; `supabase/config.toml` allows the signed webhook endpoint without a Supabase JWT. Configure the AfterShip API key, webhook secret, and webhook URL as described for migration_v47. Buyer-account marketplace order IDs are references; live scans begin once the courier AWB is available. The same migration is included in `setup.sql` for new databases.

## migration_v55_request_vendor_rate_visible.sql
Removes per-request vendor/rate visibility settings. Everyone who can view a request can also see its vendor and purchase rate; PO numbers remain role-limited. Apply after migration_v54. The update is included in `setup.sql` for new databases.

## migration_v56_purchase_misc_amount.sql
Adds a non-item miscellaneous amount to purchase orders. Procurement automatically includes the approved request installation/miscellaneous allowance once in the linked PO total, without creating a separate product line. Apply after migration_v55. The column is also included in `setup.sql` for new databases.

## migration_v57_sewadar_roster_skills_arrival_period.sql
Adds skills and a morning/noon/evening/night expected-arrival period to shared Sewadar profiles. Apply after migration_v56. The schema change is also included in `setup.sql` for new databases.

## migration_v58_event_scoped_member_operations.sql
Keeps Sewadar profiles shared while storing arrivals, badge issuance/return, call logs, Walkie allocations, and deliveries in the Normal workspace or the selected event scope for their module. Event reports show arrival, returned-back, and badge status per Sewadar. The header remembers the selected scope independently for Sewadars, Walkie, Control Rooms, and event reports. Run after migration_v57; included in `setup.sql` for new databases.

## migration_v59_room_setup_requirements.sql
Adds room setup requirements and readiness tracking to Rooms & Members. Each room can track required and already-present quantities for supplies such as fans, mattresses, and blankets; readiness is shown on the room card when all requirements are met. Bed capacity remains only for member placement and is not included in the setup requirements. Run after migration_v58; included in `setup.sql` for new databases.

## migration_v60_cctv_control_room_sewa.sql
Adds an event-scoped CCTV Control Room workspace. Each room has a location and PC count; Sewadars can be scheduled into 9 AM–12 PM, 12–3 PM, 3–6 PM, and 6–9 PM shifts, with attendance tracking and on-the-spot people. IT Department Heads and CCTV/Control Room sub-department heads can manage rooms and shift plans; CCTV and Control Room staff can add on-site attendees and mark attendance. Run after migration_v59; included in `setup.sql` for new databases.

## migration_v61_cctv_custom_shifts.sql
Adds custom start and end times for Special shifts in the CCTV Control Room roster. Run after migration_v60; included in `setup.sql` for new databases.

## migration_v62_event_calling_rosters.sql
Adds Monthly, Annual, and Special event types; Special events store their selected Sewadar IDs for the event calling roster. Run after migration_v61; included in `setup.sql` for new databases.

## migration_v63_accommodation_event_readiness.sql
Adds the Rooms & Members section under Accommodation. IT owners define per-event room requirements, including quantities and where to collect supplies; Accommodation marks each line ready and returned. Rooms show “Ready for [event]” and readiness/return timestamps when the checklists are complete. Meal plans are event-scoped and add a “Ready for event” status with a timestamp. Run after migration_v62; included in `setup.sql` for new databases.

## migration_v64_event_arrival_time.sql
Adds an event-specific expected arrival date and time for Sewadars in the Calling roster. Values are saved per selected event; existing shared profile values remain the fallback until an event-specific schedule is saved. Permanent Sewadars do not use these arrival fields. Run after migration_v63; included in `setup.sql` for new databases.

## migration_v65_permanent_member_holidays.sql
Adds Went home / Returned tracking and cumulative holiday-day totals for Permanent Sewadars. The current leave period is included in the displayed total and added to the saved total when the member returns. Run after migration_v64; included in `setup.sql` for new databases.

## migration_v66_team_task_priority.sql
Adds Immediately, Till the time, and As you have time priority levels to team tasks. Till the time tasks can store a specific deadline. Run after migration_v65; included in `setup.sql` for new databases.

## migration_v67_task_resource_handoffs.sql
Adds task-level inventory resource allocations. Team leaders confirm receipt before a task is completed; after completion, they record good and damaged quantities returned. Issue and return entries update the Inventory ledger. Run after migration_v66; included in `setup.sql` for new databases.

## migration_v68_department_feedback_updates.sql
Adds department-scoped feedback from the header shortcut, plus department-targeted or all-department announcements and lessons learned. Feedback can be submitted by department users; administrators can manage feedback and publish updates. Sub-department users can view posts for their department and posts targeted to all departments. Run after migration_v67; included in `setup.sql` for new databases.

## migration_v69_accommodation_room_categories.sql
Adds Rest room and Control room categories to Accommodation rooms. Existing rooms become Rest rooms. Control rooms can select a Sewadar team responsible for requirements; room membership continues to use the shared Accommodation roster. Event attendance counts in Rooms & Members follow the selected event and update when members arrive or are marked returned. Run after migration_v68; included in `setup.sql` for new databases.

## migration_v71_remove_food_ready_for_event.sql
Removes Ready for event from the Food menu status flow. Existing meals in that state move back to In preparation. Run after migration_v70; included in `setup.sql` for new databases.

## migration_v73_event_linked_reports.sql
Requires an event on every new issue, complaint, and feedback report submitted from the header shortcut. Admins can filter the inbox by event and link older reports that predate this migration. Run after migration_v72; included in `setup.sql` for new databases.

## migration_v75_accommodation_control_room_sync.sql
Links event-specific CCTV Control Room records to Accommodation Control Room records. Materials, quantities, ready/returned state, pickup locations, and assigned Accommodation members then show in the Control Room view. Run after migration_v74; included in `setup.sql` for new databases.

## migration_v76_event_workflow_links.sql
Connects event records to the shared meeting, task, inventory, and report flows. Adds department ownership, event-linked meetings and subtasks, audience-based meeting privacy, inventory requirement publishing, and event task links. Run after migration_v75; included in setup.sql for new databases.

## migration_v77_meeting_transcripts.sql
Stores the Teams online meeting ID so transcript-based minutes can be generated. Run after migration_v76; included in setup.sql for new databases.

## migration_v80_wifi_register_fields.sql
Adds switch location and port number to Wi-Fi access points, and From, Contact, and Device Model to issued department user IDs. Apply after migration_v79 on existing databases; included in setup.sql for new databases.

## migration_v81_accounts_vendor_payment_docs.sql
Adds the Accounts department, requires complete contact and bank details for offline vendors, and stores optional bill/payment-proof attachments in private storage. Payment requests and history are visible to Accounts; only non-owner Accounts users can record payments. Apply after migration_v80 on existing databases; included in setup.sql for new databases.

## migration_v82_event_radio_collection_unit.sql
Adds a required collection unit to event radio requests so the source appears in both Event Requirements and the Walkie-Talkie approval queue. Apply after migration_v81 on existing databases; included in setup.sql for new databases.

## migration_v83_manpower_task_assignment_access.sql
Allows authorized Accommodation sub-department leads to manage teams, task assignments, and task resources, matching the controls already shown in the app. Resource handoffs use the team lead, an assigned Sewadar, or the task owner as recipient. Apply after migration_v82 on existing databases; included in setup.sql for new databases.

## migration_v84_task_team_links.sql
Adds a validated foreign-key link between tasks and registered teams, backfills existing assignments, and keeps the displayed team name in sync. Apply after migration_v83 on existing databases; included in setup.sql for new databases.
