# Epic E7 — In-App Notifications

> **Priority:** P0 · **Owner:** Dev A · **Days:** 9–10 · **Depends on:** E3 (dashboard shell, top nav exists) · **Total estimate:** 10 hours

Users need to know when something changes without constantly refreshing. This epic wires a lightweight notification system on top of the existing `domain_events` table: a fan-out service reads events and writes targeted rows to a new `notifications` table; a bell icon in the nav polls every 15 seconds and shows a badge; new notifications pop as transient toasts. The fan-out covers four trigger events — RO Created, Task Completed, Task Blocked, RO Completed — each fanning out to the role(s) that care. No WebSockets, no push API, no service worker: polling is intentionally simple for this sprint.

---

## Story E7-S1 — Notifications table migration + service (S, 2h)

**As the system**
**I want** a `notifications` table and a service that writes targeted rows for each domain event
**So that** the API has something to serve when users poll for new notifications

### Acceptance criteria
- New migration `006_notifications.sql` creating:
  ```sql
  CREATE TABLE notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id),
    event_type  TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    entity_type TEXT,           -- e.g. 'RepairOrder', 'JobTask'
    entity_id   UUID,           -- the RO or task id for navigation
    is_read     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX ON notifications (user_id, is_read, created_at DESC);
  ```
- `INotificationService` with method `Task FanOutAsync(DomainEvent evt, CancellationToken ct)`
- Fan-out rules (which roles receive which events):
  | Event type | Recipient roles |
  |---|---|
  | `RoCreated` | SUPERVISOR, STATION_OWNER |
  | `TaskCompleted` | SUPERVISOR, STATION_OWNER (of that station) |
  | `TaskBlocked` | SUPERVISOR, STATION_OWNER (of that station) |
  | `RoCompleted` | SUPERVISOR, SALES |
- Title and body templates (examples):
  - `RoCreated`: title=`"New RO: {roNumber}"`, body=`"{customerName} — {templateCode}"`
  - `TaskCompleted`: title=`"Task complete: {operationName}"`, body=`"RO {roNumber} · {stationName}"`
  - `TaskBlocked`: title=`"BLOCKED: {operationName}"`, body=`"RO {roNumber} — {reason}"`
  - `RoCompleted`: title=`"RO complete: {roNumber}"`, body=`"{customerName} — email sent"`
- Service reads target users by querying `user_roles` for the relevant roles (and station-scoped STATION_OWNER using `stations.owner_user_id`)

### Technical context
- Register `INotificationService` / `NotificationService` as scoped in `Program.cs`
- Call `FanOutAsync` from within each endpoint that raises a domain event (RO creation in `RepairOrderEndpoints`, task complete/block in `TechEndpoints`, QC complete in the E6 endpoint)
- The payload for each domain event type is JSON — parse the relevant fields from `DomainEvent.Payload.RootElement`
- Station-scoped STATION_OWNER: for TaskCompleted/TaskBlocked, the station's `owner_user_id` is the recipient (already in `stations` table)

### Done definition
- Trigger `POST /api/repair-orders` (create an RO) → `notifications` table has rows for all SUPERVISOR and STATION_OWNER users
- Trigger `POST /api/tech/tasks/{id}/block` → notification created for the SUPERVISOR and the station owner
- `SELECT * FROM notifications;` in psql shows correct title/body for each event
- Integration test: create RO, check notifications count and content

### Claude Code prompt
```
Add the notifications table and fan-out service:

1. Migration 006_notifications.sql: CREATE TABLE notifications as specified above.
   Add to NeeDbContext: DbSet<Notification>. Add Notification entity to Domain/Production.cs:
   { Id, UserId, EventType, Title, Body, EntityType, EntityId, IsRead, CreatedAt }

2. INotificationService + NotificationService:
   File: api/Services/NotificationService.cs
   - FanOutAsync(DomainEvent evt, CancellationToken ct):
     a. Parse evt.Payload.RootElement to extract relevant fields
     b. Determine target user IDs based on evt.EventType (see fan-out rules above)
        - For role-based: query user_roles JOIN users WHERE role code IN (...)
        - For station-scoped: read stations.owner_user_id where station matches
     c. Bulk INSERT notifications rows (one per target user)
   - Register as scoped: builder.Services.AddScoped<INotificationService>()

3. Wire fan-out calls into existing endpoints:
   - RepairOrderEndpoints.cs POST /api/repair-orders: after SaveChanges, inject INotificationService, call await svc.FanOutAsync(domainEvent, ct)
   - TechEndpoints.cs POST /{id}/complete: same pattern after domain event insert
   - TechEndpoints.cs POST /{id}/block: same pattern
   - E6 QC-complete endpoint: same pattern for RoCompleted event

4. Integration test (NotificationTests.cs):
   - Create RO → verify supervisor has notification with event_type='RoCreated'
   - Block a task → verify supervisor notification with event_type='TaskBlocked', body contains reason

Schema: notifications, domain_events, user_roles, users, stations.
```

---

## Story E7-S2 — GET notifications endpoint + mark-read (S, 2h)

**As a user**
**I want** to fetch my notifications and mark them read
**So that** the bell icon and notification list have an API to call

### Acceptance criteria
- `GET /api/notifications` returns notifications for the current user, unread first, max 50:
  ```json
  [
    {
      "id": "...",
      "eventType": "TaskBlocked",
      "title": "BLOCKED: Fabrication line assembly",
      "body": "RO00001 — Waiting for chassis delivery from supplier",
      "entityType": "JobTask",
      "entityId": "...",
      "isRead": false,
      "createdAt": "2026-05-01T09:00:00Z"
    }
  ]
  ```
- `GET /api/notifications/unread-count` returns `{ "count": 3 }` — this is the lightweight poll endpoint (smaller response, faster)
- `POST /api/notifications/{id}/read` marks a single notification as read, returns 204
- `POST /api/notifications/read-all` marks all as read for the current user, returns 204
- All endpoints require `[Authorize]` — users only see their own notifications
- `unread-count` returns 0 (not 401) for authenticated users with no notifications

### Technical context
- Ordering: `ORDER BY is_read ASC, created_at DESC` — unread always floats to the top
- `LIMIT 50` on the list endpoint — no pagination in v1
- The `/read-all` is a single `UPDATE notifications SET is_read = true WHERE user_id = currentUser AND is_read = false`

### Done definition
- After creating an RO, `GET /api/notifications` (as supervisor) returns at least one notification
- After `POST .../read-all`, unread-count returns 0
- `GET /api/notifications` as a different user returns empty (isolation works)
- Integration tests: GET after fan-out, mark read, read-all, user isolation

### Claude Code prompt
```
Add notification query endpoints:

1. New endpoint group in Program.cs: app.MapNotificationEndpoints()
   File: api/Endpoints/NotificationEndpoints.cs

   GET /api/notifications
   - currentUserId from JWT
   - Query notifications WHERE user_id = currentUser ORDER BY is_read ASC, created_at DESC LIMIT 50
   - Return NotificationDto[]

   GET /api/notifications/unread-count
   - COUNT(id) WHERE user_id = currentUser AND is_read = false
   - Return { Count: int }

   POST /api/notifications/{id}/read
   - Find notification WHERE id = ? AND user_id = currentUser (404 if not found or wrong user)
   - UPDATE is_read = true
   - Return 204

   POST /api/notifications/read-all
   - ExecuteSqlRawAsync("UPDATE notifications SET is_read = true WHERE user_id = {0} AND is_read = false", currentUser)
   - Return 204

2. All endpoints: .RequireAuthorization().WithTags("Notifications")

3. Integration tests (NotificationEndpointTests.cs):
   - GET returns empty array when no notifications
   - After fan-out: GET returns notification, unread-count = 1
   - POST /read → 204, GET shows is_read = true
   - POST /read-all → 204, unread-count = 0
   - GET as different user returns empty (user isolation)

Schema: notifications.
```

---

## Story E7-S3 — Bell icon + notification dropdown in nav (M, 3h)

**As a user**
**I want** a bell icon in the top nav with an unread badge that opens a notification dropdown
**So that** I can see new events without leaving the current page

### Acceptance criteria
- Bell icon added to the top-right of the existing nav bar (all authenticated views share this nav)
- A red badge on the bell shows the unread count when > 0; hidden when 0
- Clicking the bell opens a dropdown panel listing the 10 most recent notifications
- Each notification row shows: title (bold), body (smaller, muted), time ago (e.g. "3 min ago"), and a coloured dot (red for TaskBlocked, green for RoCompleted, blue for others)
- Read notifications are visually dimmed (opacity 0.5)
- Clicking a notification: marks it read (calls `POST .../read`), then navigates to the relevant entity if `entityType` is set (RO → `/sales/ros/{entityId}`, Task → `/tech/tasks/{entityId}`)
- A "Mark all read" link at the bottom of the dropdown
- Clicking outside the dropdown closes it
- The bell polls `GET /api/notifications/unread-count` every 15 seconds

### Technical context
- The existing nav is in `web/src/app/core/` — find the nav component and add the bell there
- Use Angular `Signal` + `interval(15000)` for the poll (same pattern as the kanban board)
- The dropdown is a positioned `div` that toggles on bell click; close on `document:click` using `@HostListener`
- "Time ago" formatting: a simple pipe or function: `< 1 min`, `N min ago`, `N hr ago`, `N day ago`

### Done definition
- Create an RO → bell on supervisor's nav shows badge "1"
- Click bell → dropdown shows the notification
- Click notification → marked read, navigated to the RO detail page
- Badge disappears after "Mark all read"
- Badge re-appears 15 seconds later if a new event fires (manual test: create another RO in another tab)

### Claude Code prompt
```
Add the bell icon notification system to the nav:

1. Find the existing nav component (likely app.component.ts or a shared nav component).
   Add a NotificationBellComponent (standalone) and place it in the nav template.

2. NotificationBellComponent (web/src/app/core/notification-bell.component.ts):
   - Signals: unreadCount = signal(0), notifications = signal<NotificationItem[]>([]), isOpen = signal(false)
   - On init: load unreadCount, start interval(15000) using takeUntilDestroyed to poll unread-count
   - toggleOpen(): if opening and notifications is empty, call GET /api/notifications
   - @HostListener('document:click', ['$event']) closeIfOutside()

   Template:
   <div class="bell-wrapper">
     <button class="bell-btn" (click)="toggleOpen(); $event.stopPropagation()">
       🔔
       @if (unreadCount() > 0) { <span class="bell-badge">{{ unreadCount() }}</span> }
     </button>
     @if (isOpen()) {
       <div class="notif-panel" (click)="$event.stopPropagation()">
         <div class="notif-header">
           <span class="notif-title">Notifications</span>
           <button class="mark-all" (click)="markAllRead()">Mark all read</button>
         </div>
         @for (n of notifications(); track n.id) {
           <div class="notif-row" [class.is-read]="n.isRead" (click)="onNotifClick(n)">
             <span class="notif-dot" [class]="dotClass(n.eventType)"></span>
             <div class="notif-content">
               <span class="notif-row-title">{{ n.title }}</span>
               <span class="notif-row-body">{{ n.body }}</span>
               <span class="notif-row-time">{{ timeAgo(n.createdAt) }}</span>
             </div>
           </div>
         }
         @if (notifications().length === 0) {
           <div class="notif-empty">No notifications</div>
         }
       </div>
     }
   </div>

3. NotificationService (Angular, web/src/app/core/notification.service.ts):
   - getNotifications(): Observable<NotificationItem[]>
   - getUnreadCount(): Observable<{ count: number }>
   - markRead(id: string): Observable<void>
   - markAllRead(): Observable<void>

4. Styles:
   .bell-wrapper (position relative)
   .bell-btn (background none, border none, font-size 20px, cursor pointer, position relative, padding 4px)
   .bell-badge (position absolute, top -4px, right -4px, background var(--bad), color white,
     font-size 10px, font-weight 700, border-radius 10px, min-width 16px, height 16px,
     display flex, align-items center, justify-content center, padding 0 3px)
   .notif-panel (position absolute, right 0, top calc(100% + 8px), width 320px, background white,
     border: 0.5px solid var(--rule-strong), border-radius 10px, box-shadow 0 4px 24px rgba(10,14,15,0.12),
     z-index 200, max-height 400px, overflow-y auto)
   .notif-row (display flex, gap 10px, padding 12px 14px, cursor pointer, border-bottom 0.5px solid var(--rule))
   .notif-row:hover (background var(--paper))
   .is-read (opacity 0.5)
   .notif-dot (width 8px, height 8px, border-radius 50%, flex-shrink 0, margin-top 4px)
   .dot-blocked (background var(--bad))
   .dot-completed (background var(--good))
   .dot-default (background var(--info))
   .notif-row-title (font-size 13px, font-weight 600, color var(--ink), display block)
   .notif-row-body (font-size 12px, color var(--ink-3), display block)
   .notif-row-time (font-family var(--mono), font-size 10px, color var(--ink-3), display block, margin-top 2px)
   .notif-header (display flex, justify-content space-between, align-items center, padding 10px 14px,
     border-bottom 0.5px solid var(--rule))
   .mark-all (background none, border none, font-size 11px, color var(--accent), cursor pointer)
```

---

## Story E7-S4 — Toast component + new-notification pop (S, 3h)

**As a user**
**I want** a toast to pop in the corner when a new notification arrives while I'm using the app
**So that** I don't have to watch the bell to notice new events

### Acceptance criteria
- Toast appears in the bottom-right corner of the screen for 5 seconds, then auto-dismisses
- Toast shows: event type icon (🔔 for new RO, ⚠️ for blocked, ✓ for complete), title, body, and a "×" close button
- Toasts stack vertically if multiple arrive in the same poll cycle (max 3 visible at once; extras queued)
- On click (anywhere on the toast except ×): marks the notification read and navigates to the entity
- Toast only pops for **new** notifications — those with `createdAt` after the last poll time
- Polling detects new notifications by comparing the returned notifications list against a local `lastSeen` timestamp stored in the component signal
- Toast does **not** pop on the first load (cold start) — only for events that arrive after the app is open

### Technical context
- `ToastService` (Angular): a shared service with a `BehaviorSubject<Toast[]>` that any component can push to
- `ToastContainerComponent`: placed in `AppComponent` template (above all routes), subscribes to the service and renders active toasts
- The `NotificationBellComponent` drives the polling and pushes to `ToastService` when new notifications arrive
- Auto-dismiss: each toast has a `setTimeout(5000)` that removes it from the array

### Done definition
- App is open on the dashboard; in another terminal, create a new RO via API
- Within 15 seconds, a toast pops in the bottom-right: "New RO: RO00002"
- Toast disappears after 5 seconds
- Clicking the toast marks it read and navigates to the RO detail page
- Two new events at the same time: two toasts stack
- On first app load: no toasts (cold start suppressed)

### Claude Code prompt
```
Add the toast notification system:

1. ToastService (web/src/app/core/toast.service.ts):
   interface Toast { id: string; icon: string; title: string; body: string; entityType?: string; entityId?: string; notifId?: string }
   - toasts = signal<Toast[]>([])
   - push(toast: Omit<Toast, 'id'>): auto-generate id, add to signal, setTimeout 5000 to remove
   - dismiss(id: string): remove from signal

2. ToastContainerComponent (web/src/app/core/toast-container.component.ts):
   Standalone. Inject ToastService. Place in AppComponent template as <app-toast-container />.
   Template:
   <div class="toast-stack">
     @for (toast of toastService.toasts(); track toast.id) {
       <div class="toast" (click)="onToastClick(toast)">
         <span class="toast-icon">{{ toast.icon }}</span>
         <div class="toast-content">
           <span class="toast-title">{{ toast.title }}</span>
           <span class="toast-body">{{ toast.body }}</span>
         </div>
         <button class="toast-close" (click)="$event.stopPropagation(); toastService.dismiss(toast.id)">×</button>
       </div>
     }
   </div>
   Styles:
   .toast-stack (position fixed, bottom 20px, right 20px, z-index 500, display flex,
     flex-direction column-reverse, gap 8px, max-width 320px)
   .toast (background white, border 0.5px solid var(--rule-strong), border-radius 10px,
     padding 12px 14px, display flex, align-items flex-start, gap 10px,
     box-shadow 0 4px 16px rgba(10,14,15,0.12), cursor pointer,
     animation slideToast 0.25s ease)
   @keyframes slideToast { from { transform: translateX(110%); } to { transform: translateX(0); } }
   .toast-icon (font-size 18px, flex-shrink 0)
   .toast-title (font-size 13px, font-weight 600, color var(--ink), display block)
   .toast-body (font-size 12px, color var(--ink-3), display block)
   .toast-close (background none, border none, font-size 16px, cursor pointer, color var(--ink-3),
     margin-left auto, padding 0 0 0 8px, flex-shrink 0)

3. Update NotificationBellComponent:
   - Add lastSeenAt = signal<Date | null>(null)
   - In the polling interval: after fetching notifications, compare each notification.createdAt > lastSeenAt()
   - For each new notification: call toastService.push({ icon: iconFor(n.eventType), title: n.title, body: n.body, entityType: n.entityType, entityId: n.entityId, notifId: n.id })
   - Update lastSeenAt to now() after first successful poll (cold start: set lastSeenAt on init, don't toast for existing notifications)

4. iconFor(eventType): 'RoCreated'→'🔔', 'TaskBlocked'→'⚠️', 'TaskCompleted'→'✓', 'RoCompleted'→'✅', default→'🔔'

5. Toast click navigation: inject Router, on click call notificationService.markRead(toast.notifId), then navigate based on entityType ('RepairOrder'→/sales/ros/:id, 'JobTask'→/tech/tasks/:id)
```
