# Adapt Linear Issue -- Worked Examples

Reference examples for the `adapt-linear-issue` skill. Each example shows the
original issue as fetched, the normalized sub-issue created, and the back-link
comment posted on the original.

---

## Example 1: Vague One-Liner

### Original Issue (fetched via `get_issue`)

- **Identifier**: `APP-101`
- **Title**: `Fix login`
- **Priority**: 1 (Urgent)
- **Description**: *(empty)*
- **Project**: `Web App`
- **Team**: `Frontend`
- **Labels**: `bug`

### Comments (fetched via `list_comments`)

1. *Carlos*: "Users on Safari can't log in since yesterday's deploy. They get a
   blank screen after clicking Sign In."
2. *Dana*: "Confirmed -- it's the OAuth callback. Safari blocks the redirect
   because we're setting cookies without SameSite=None on the auth response."
3. *Carlos*: "Need this fixed today, three enterprise customers are affected."

### Normalized Sub-Issue (created via `save_issue`)

- **Title**: `fix(auth): resolve Safari OAuth redirect blocked by SameSite cookie policy`
- **Parent**: `APP-101`
- **Priority**: 1 (Urgent)
- **Labels**: `bug`, `auth`
- **Description**:

```markdown
## Context

Adapted from APP-101. Since the most recent deploy, Safari users see a blank
screen after clicking Sign In. The OAuth callback redirect is blocked because
auth response cookies are not setting the `SameSite=None` attribute, which
Safari requires for cross-site redirects. Three enterprise customers are
affected.

## Requirements

1. Set `SameSite=None; Secure` on all cookies in the OAuth callback response
2. Verify that the fix does not break login on Chrome, Firefox, or Edge
3. Ensure cookies are only set with `Secure` when served over HTTPS

## Technical Hints

- The OAuth callback handler sets cookies on the auth response
- Safari enforces stricter SameSite defaults than other browsers
- The issue appeared after the most recent deploy -- check recent cookie or
  auth middleware changes

## Acceptance Criteria

- [ ] OAuth callback sets `SameSite=None; Secure` on auth cookies
- [ ] Safari users can complete the login flow without a blank screen
- [ ] Login still works on Chrome, Firefox, and Edge
- [ ] Existing auth tests still pass
- [ ] New test verifies cookie attributes on the OAuth callback response

## Scope

- **In scope**: Fixing the SameSite cookie attribute on the OAuth callback
- **Out of scope**: General OAuth flow refactoring, session management changes, SSO
```

### Back-Link Comment (posted on APP-101)

> Created AI-digestible sub-issue **APP-102** for AgentForge orchestration.
>
> The sub-issue contains a normalized description with structured context,
> requirements, acceptance criteria, and scope boundaries derived from this
> issue and its discussion thread.

---

## Example 2: Detailed but Unstructured Description

### Original Issue (fetched via `get_issue`)

- **Identifier**: `PLAT-88`
- **Title**: `Implement webhook retry logic`
- **Priority**: 2 (High)
- **Description**:

  > We need to add retry logic for outbound webhooks. Right now when a webhook
  > delivery fails we just drop it and log an error. Customers have asked for
  > reliable delivery. I think we should do exponential backoff with jitter,
  > maybe 3-5 retries max. We also need a dead letter queue for webhooks that
  > fail all retries so we can inspect them later. Oh and we should probably add
  > a webhook delivery status endpoint so customers can check if their webhooks
  > are being delivered. Let me know what you think about the retry count -- 3
  > or 5?

- **Project**: `Platform API`
- **Team**: `Platform`
- **Labels**: `feature`

### Comments (fetched via `list_comments`)

1. *Eve*: "5 retries with exponential backoff (base 2s, jitter up to 1s) sounds
   right. Cap at ~60s between retries."
2. *Frank*: "For the dead letter queue, let's use the existing `failed_jobs`
   table rather than a new table. Just add a `webhook_delivery` job type."
3. *Eve*: "Agreed. The status endpoint can be v2 -- let's not scope-creep this
   ticket."

### Normalized Sub-Issue (created via `save_issue`)

- **Title**: `feat(webhooks): add exponential backoff retry with dead letter queue`
- **Parent**: `PLAT-88`
- **Priority**: 2 (High)
- **Labels**: `feature`, `webhooks`
- **Description**:

```markdown
## Context

Adapted from PLAT-88. Outbound webhook deliveries are currently fire-and-forget
-- failures are logged but not retried. Customers have requested reliable
delivery. The team has agreed on exponential backoff with 5 retries and a dead
letter queue using the existing `failed_jobs` table.

## Requirements

1. Retry failed webhook deliveries up to 5 times using exponential backoff
   (base 2s, jitter up to 1s, max interval ~60s)
2. After all retries are exhausted, move the failed delivery to the dead letter
   queue via the existing `failed_jobs` table with job type `webhook_delivery`
3. Log each retry attempt and final failure with delivery metadata
4. Failed deliveries in the dead letter queue are queryable for inspection

## Technical Hints

- Reuse the existing `failed_jobs` table -- add a `webhook_delivery` job type
  rather than creating a new table
- The webhook status endpoint was explicitly deferred to a follow-up issue
- Current webhook dispatch is fire-and-forget in the outbound webhook handler

## Acceptance Criteria

- [ ] Failed webhook deliveries are retried up to 5 times
- [ ] Backoff follows exponential curve: 2s base, jitter up to 1s, max ~60s
- [ ] After 5 failures, delivery is recorded in `failed_jobs` with type
      `webhook_delivery`
- [ ] Dead letter entries include the original payload, target URL, and error
- [ ] Retry attempts are logged with attempt number and next retry time
- [ ] Existing tests still pass
- [ ] New tests cover retry exhaustion, successful retry on 2nd attempt, and
      dead letter queue insertion

## Scope

- **In scope**: Webhook retry logic with exponential backoff, dead letter queue
  via `failed_jobs` table
- **Out of scope**: Webhook delivery status API endpoint (deferred per team
  discussion), webhook payload schema changes, customer-facing retry
  configuration
```

### Back-Link Comment (posted on PLAT-88)

> Created AI-digestible sub-issue **PLAT-89** for AgentForge orchestration.
>
> The sub-issue contains a normalized description with structured context,
> requirements, acceptance criteria, and scope boundaries derived from this
> issue and its discussion thread.

---

## Example 3: Bug Report Missing Repro Steps

### Original Issue (fetched via `get_issue`)

- **Identifier**: `MOB-55`
- **Title**: `App crashes when uploading large files`
- **Priority**: 2 (High)
- **Description**:

  > Several users reported that the app crashes when they try to upload files.
  > Seems to only happen with larger files.

- **Project**: `Mobile App`
- **Team**: `Mobile`
- **Labels**: `bug`

### Comments (fetched via `list_comments`)

1. *Grace*: "I reproduced this with a 150MB video file. The app runs out of
   memory because we're loading the entire file into a buffer before uploading."
2. *Hank*: "We should stream the upload instead. The backend already supports
   chunked transfer encoding."
3. *Grace*: "Tested with files under 50MB and those work fine. So the threshold
   is somewhere between 50-150MB. The device I tested on has 4GB RAM."
4. *Hank*: "Let's also add a file size limit in the UI so users get a clear
   error instead of a crash. 100MB seems reasonable for now."

### Normalized Sub-Issue (created via `save_issue`)

- **Title**: `fix(upload): stream large file uploads to prevent OOM crash`
- **Parent**: `MOB-55`
- **Priority**: 2 (High)
- **Labels**: `bug`, `upload`
- **Description**:

```markdown
## Context

Adapted from MOB-55. The app crashes with an out-of-memory error when users
upload files larger than ~50-100MB. The current implementation loads the entire
file into a memory buffer before uploading. The backend already supports chunked
transfer encoding, so the fix is to switch to a streaming upload on the client
side.

## Requirements

1. Replace the in-memory file buffer with a streaming upload using chunked
   transfer encoding
2. Add a client-side file size limit of 100MB with a clear error message shown
   before upload begins
3. Uploads of files under 100MB must continue to work without regression

## Technical Hints

- The backend already supports chunked transfer encoding -- no backend changes
  needed
- Reproduced with a 150MB video file on a 4GB RAM device
- Files under 50MB work fine with the current implementation
- The crash is an OOM in the upload buffer allocation

## Acceptance Criteria

- [ ] Files up to 100MB upload successfully without OOM crash
- [ ] Files over 100MB are rejected client-side with a user-facing error message
      before upload starts
- [ ] Upload uses streaming/chunked transfer instead of loading the full file
      into memory
- [ ] Memory usage during upload stays within acceptable bounds (no spike to
      file-size magnitude)
- [ ] Existing upload tests still pass
- [ ] New tests cover: streaming upload of a large file, client-side rejection
      of oversized file

## Scope

- **In scope**: Streaming upload implementation, client-side file size validation
- **Out of scope**: Backend upload changes, resumable uploads, upload progress UI
  improvements, compression
```

### Back-Link Comment (posted on MOB-55)

> Created AI-digestible sub-issue **MOB-56** for AgentForge orchestration.
>
> The sub-issue contains a normalized description with structured context,
> requirements, acceptance criteria, and scope boundaries derived from this
> issue and its discussion thread.

---

## Example 4: Feature Request with Scattered Comment Context

### Original Issue (fetched via `get_issue`)

- **Identifier**: `DASH-33`
- **Title**: `We need dark mode`
- **Priority**: 3 (Medium)
- **Description**:

  > Multiple customers have asked for a dark mode option. Let's add it.

- **Project**: `Dashboard`
- **Team**: `Frontend`
- **Labels**: `feature`, `ui`

### Comments (fetched via `list_comments`)

1. *Ivy*: "We're using Tailwind. The `dark:` variant is already configured in
   `tailwind.config.ts` but we haven't used it anywhere."
2. *Jack*: "Should we use system preference or a manual toggle? I'd say both --
   default to system preference but let the user override in settings."
3. *Ivy*: "Agreed. We can store the preference in localStorage. The settings
   page already has a 'Preferences' section at `/settings/preferences`."
4. *Jack*: "Let's start with the shell (nav, sidebar, layout) and the main
   dashboard page. We can do the remaining pages in follow-up tickets."
5. *Ivy*: "The design team uploaded mockups in Figma: [link]. Key colors: bg
   `#0f172a`, text `#e2e8f0`, accent stays the same brand blue."

### Normalized Sub-Issue (created via `save_issue`)

- **Title**: `feat(ui): add dark mode toggle with system preference detection`
- **Parent**: `DASH-33`
- **Priority**: 3 (Medium)
- **Labels**: `feature`, `ui`
- **Description**:

```markdown
## Context

Adapted from DASH-33. Multiple customers have requested dark mode support. The
project uses Tailwind CSS with the `dark:` variant already configured but unused.
The team agreed to default to system preference with a manual override stored in
localStorage, and to scope the initial implementation to the shell and main
dashboard page.

## Requirements

1. Implement a dark mode toggle in the settings page at `/settings/preferences`
2. Default to the user's system color scheme preference (`prefers-color-scheme`)
3. Allow manual override that persists in `localStorage`
4. Apply dark mode styles to the app shell (navigation, sidebar, layout) and the
   main dashboard page
5. Use the agreed color palette: background `#0f172a`, text `#e2e8f0`, keep
   existing brand blue for accent

## Technical Hints

- Tailwind `dark:` variant is configured in `tailwind.config.ts` but not yet
  used in any components
- Settings page has an existing "Preferences" section at `/settings/preferences`
- Preference stored in `localStorage`; read on app init to apply the correct
  class before first paint
- Figma mockups exist (referenced in issue comments)

## Acceptance Criteria

- [ ] Dark mode toggle exists on `/settings/preferences`
- [ ] Defaults to system preference when no override is stored
- [ ] Manual selection persists in `localStorage` and survives page reload
- [ ] App shell (nav, sidebar, layout) renders correctly in dark mode
- [ ] Main dashboard page renders correctly in dark mode
- [ ] No flash of wrong theme on initial page load
- [ ] Existing tests still pass
- [ ] New tests cover toggle behavior, localStorage persistence, and system
      preference detection

## Scope

- **In scope**: Dark mode for app shell and main dashboard page, toggle in
  settings, system preference detection
- **Out of scope**: Dark mode for all other pages (follow-up tickets), theme
  customization beyond light/dark, dark mode for email templates
```

### Back-Link Comment (posted on DASH-33)

> Created AI-digestible sub-issue **DASH-34** for AgentForge orchestration.
>
> The sub-issue contains a normalized description with structured context,
> requirements, acceptance criteria, and scope boundaries derived from this
> issue and its discussion thread.
