# Legal-request runbook

Plain-language steps for the owner when the police, NBI, a prosecutor, the DOJ or the NPC
contacts Swoony. This runbook is not legal advice.

## Before you need it

- **Abuse mailbox:** `abuse@swoony.chat` (set up in Task 15). Check it **at least twice a day**,
  morning and evening, every day. A takedown notice starts a 24-hour clock from the moment it
  arrives, not from when you read it. Turn on phone notifications for this mailbox.
- **Admin page:** `https://swoony.chat/s-admin`. Sign in with your email: Cloudflare sends a
  one-time code that works for 10 minutes. Only your email and your listed IP addresses can sign
  in (set in Cloudflare Zero Trust, Access). If your home or phone IP changes, add the new one
  there first. A sign-in lasts 8 hours; after that the page says "Your session ended" and you
  sign in again. Sign-in history is in Zero Trust, Logs, Access.
- **Admin token (backup tools only):** a long random secret stored as the `ADMIN_TOKEN` Worker
  secret, used by the terminal tools at the end of this runbook. Keep a copy in your password
  manager only. Never put it in the repo, a chat, an email or a screenshot. If it may have
  leaked, set a new one right away (`npx wrangler secret put ADMIN_TOKEN`).
- **Request log:** keep a private spreadsheet (outside the repo) with one row per request:
  date and time received, who sent it, reference number, what they asked for, what you did and
  when, and what you sent back. Keep the original emails and letters. The admin page's
  Activity log also records every search, download and action with its case reference.
- **Case reference:** every search, download and action on the admin page needs one. Use the
  reference number on the notice (for example `NBI-2026-1142`): 3 to 40 letters, digits, `-`
  or `/`. If a request has no number, make one up and write it in the request log, for example
  `SWOONY-2026-001`.

## The admin page

| Page or button | What it does |
|---|---|
| Case lookup | Search by nickname or user ID and a date range (whole days, Philippine time). Without a nickname or user ID the range can be at most 1 day. Tabs show connection records (nickname, IP, country, times), chats (who with whom) and saved messages (every chat's archived messages for 1 year, plus report and takedown snapshots) |
| Hold 1 year (on a user or chat row) | Keeps that person's or chat's records until 1 year from today, even past the normal deletion date. A hold can only be extended, never released early |
| Ban (on a user row) | Bans the person's device for 7 days and their network for 1 hour, and removes them if they are online. Ban again after 7 days if needed |
| Take down (on a chat row) | Ends the chat right away. First saves its live messages as encrypted evidence (kept 1 year, under a hold), then wipes the live chat and deletes its other saved snapshots (except copies under a hold). The chat's record and archived messages are kept and held for 1 year, including messages archived after the takedown |
| Download CSV | One zip file with three spreadsheets (connections, chats, messages) and `fingerprint.txt` |
| Export case file (PDF) | A printable case file for the police, NBI or a prosecutor. Each saved chat also has its own PDF button. A chat with more than 4,000 saved messages comes in parts: after the first download, buttons for every part appear (for example "PDF part 2 of 3"); send all parts |
| Holds | Every record currently kept past its normal deletion date |
| Activity log | Every search, download and action, with the case reference, and whether the log's chain is intact (nobody edited or removed an entry) |
| System health | Whether the site, database, ban store and lobby work, and the daily clean-up history |
| Maintenance | Takes the chat offline (see section 7) |

Every action asks you to confirm and repeats the target and the case reference. Check both
before you confirm.

**Downloads and fingerprints.** After a download the page shows the file's fingerprint
(SHA-256), and the Activity log keeps it. It proves later exactly which file you sent: write it
in the request log. The PDF also prints a "records fingerprint" on its last page, with one line
on how to recompute it from the records. **Always save downloads outside the project folder**,
for example in `$HOME\swoony-legal\`, and delete them once the issuer confirms receipt.

## 1. Takedown notice (act within 24 hours)

A notice says specific content or a specific user involves child sexual abuse or exploitation
(OSAEC/CSAEM) and must be blocked or taken down.

1. **Check it is real.** It should come from a competent authority (PNP, NBI, DOJ, a
   prosecutor, a court) or be detailed enough to act on (nickname, date and time, what was
   said). If it comes from an unknown sender, call the agency's official number (found on its
   official website, not in the email) to confirm. Do not let checking push you past 24 hours:
   if the notice is detailed and plausible, act first and keep checking in parallel.
2. **Find the records.** On Case lookup, search the nickname with a date range a little wider
   than the one in the notice, using the notice's reference as the case reference. Note the
   user ID and any chat ID that matches.
3. **Hold the evidence first.** Press **Hold 1 year** on the user's row, so the connection
   records and any saved chats are not deleted by take down or by the normal clean-up.
4. **Ban.** Press **Ban** on the same row.
5. **Take down.** On the Chats tab, press **Take down** on each matching chat. The page saves
   the chat's live messages as held evidence before wiping it; its archived messages are held for
   1 year too. Held copies stay for the authorities and other snapshots for that chat are deleted.
6. **Record it.** Write the times of each step in the request log. The Activity log has them
   too.
7. **Reply** to the sender confirming what was done and when.
8. Go to step 2 below: the DOJ report is due within 3 days.

## 2. Report to the DOJ (within 3 days)

Every block or takedown, and any "unusual data activity" (for example, a sudden wave of
accounts sharing contact details with minors), must be reported to the DOJ within 3 days.
Send it to the DOJ Office of Cybercrime; confirm the current reporting address on the DOJ's
official website before launch and write it here.

Template:

> Subject: RA 11930 Sec. 9(a)(4) report: Swoony (swoony.chat), [date]
>
> Swoony is an anonymous 1-on-1 chat website operated by [legal name], [address].
>
> On [date and time, PHT] we received [a notice from AGENCY, reference NUMBER / a report]
> concerning [short description, no explicit material].
>
> Actions taken:
> - [date and time]: banned the user with nickname [nickname] (internal ID [userId]).
> - [date and time]: took down [number] chat(s) (internal IDs [chatIds]).
> - [date and time]: placed a preservation hold on the related records until [date].
>
> We hold the following records for this user: connection records (nickname, IP address,
> country, connection times) and [the saved copy of the reported chat(s)]. We will disclose
> them on receipt of a subpoena or lawful order.
>
> Contact: [name], [phone], abuse@swoony.chat

Do not attach chat content or IP addresses to this email. Those are released only under step 3.

## 3. Subpoena or court order

1. **Check it is official:** a signed document from the PNP, NBI, a prosecutor or a court, with
   a case or reference number. Confirm by calling the issuing office on its official number.
   Send a copy to your lawyer.
2. **Export only what it describes.** On Case lookup, use exactly the names, IDs and date range
   in the document, with its reference as the case reference. Do not widen the search "to be
   helpful". Then press **Export case file (PDF)** or **Download CSV**, whichever the issuer
   wants. For one chat only, use the **PDF** button on that saved chat.
3. **Check the output** before sending: remove records of other people that are not named in
   the order (for example, the other side of a chat, unless the order asks for it). The PDF
   cannot be edited; if it holds records of people not named in the order, send the CSV
   instead with those rows deleted, and note in the request log what you removed.
4. **Send it securely:** hand it over in person or by the channel the issuer specifies.
   Do not send it by ordinary email unless the issuer asks you to. Delete your local copy once
   the issuer confirms receipt, and record what you sent, when, and the file fingerprint the
   page showed.

## 4. Preservation request

An authority asks you to keep records longer while it prepares a case.

1. Check it is real (as in step 1.1).
2. Find the user or chat on Case lookup.
3. Press **Hold 1 year** on its row. If the request asks for a later end date, use the backup
   `hold.ts` tool below with `--until`. The law allows a 6-month extension on notice; if no
   date is given, 1 year from today covers it. A hold can be extended later but never
   shortened.
4. Record it and confirm to the sender. Diary a reminder before the hold ends in case they ask
   for more time. The Holds page lists every active hold and its end date.

## 5. Data breach (notify the NPC within 72 hours)

A breach is any loss of or unauthorised access to personal data: a leaked admin token,
`RETENTION_KEY` or `IDENTITY_HASH_SECRET`, someone else signing in to the admin page, a stolen
laptop holding an export, or a bug that showed one user's data to another.

1. **Contain it right away** and write down what happened and when you found out. The
   72 hours start when you become aware of it.
   - A leaked `ADMIN_TOKEN`: set a new one now (`npx wrangler secret put ADMIN_TOKEN`).
   - Someone else signed in to the admin page, or your email was taken over: in Cloudflare
     Zero Trust, Access, revoke all sessions for the admin application, secure your email, and
     check the admin page's Activity log for what they did.
   - A leaked `COOKIE_SECRETS`: add a new secret at the front of the list
     (`npx wrangler secret put COOKIE_SECRETS`, value `new,old`), then drop the old one a day
     later.
   - A leaked `RETENTION_KEY` or `IDENTITY_HASH_SECRET`: **do not replace it yourself.**
     Replacing `RETENTION_KEY` makes every kept legal record unreadable, and replacing
     `IDENTITY_HASH_SECRET` disconnects existing bans and reports. Contact the developer the
     same day; it needs a migration that re-encrypts or re-hashes the stored records.
2. **Tell your lawyer and your Data Protection Officer** (you, if you are the DPO).
3. **Notify the NPC within 72 hours** if the breach involves sensitive personal information
   (age counts) or information that could enable identity fraud, and is likely to cause
   serious harm. When unsure, notify. Use the NPC's online breach notification channel on its
   official website.
4. **Notify affected users** if they can be reached. Swoony has no accounts or emails, so this
   usually means a notice on the site.

Template for the NPC:

> Subject: Personal data breach notification: Swoony (swoony.chat)
>
> Personal information controller: [legal name], [address], NPC registration [number].
> DPO: [name], [phone], [email].
>
> When it happened: [date and time, or best estimate]. When we found out: [date and time].
> What happened: [plain description].
> Personal data involved: [for example: nicknames, IP addresses, ages, chat content of
> reported chats]. Approximate number of people affected: [number].
> Likely consequences: [assessment].
> What we have done: [containment steps with times].
> What we will do next: [steps], and how we will inform affected people: [method].

## 6. The abuse mailbox

- Address: `abuse@swoony.chat`, listed on the Terms, Privacy and `/safety/` pages.
- Check it at least twice a day (morning and evening, including weekends), and right away when
  your phone notifies you.
- Move each handled email to a "Done" folder and log it in the request log.
- User complaints that are not legal notices (spam, rudeness) are handled by the automatic
  reporting system; you do not need to act on them.

## 7. Maintenance mode

Normal updates do not need it: deploys switch over without downtime. Use it only for risky
database changes or emergencies.

1. On the admin page, open **Maintenance**, optionally type a short message for visitors, and
   press **Turn on maintenance mode**. Everyone online is removed right away and all open chats
   end. Visitors see "Swoony is down for a short update. Please come back soon." The landing,
   Terms, Privacy and Safety pages stay up, and the admin page, health check and daily
   clean-up keep working.
2. Do the work.
3. Press **Turn off maintenance mode**. Entry opens again right away; nobody is brought back,
   people enter again as new.

Both changes are written to the Activity log. The uptime monitor reports "maintenance" (not
"down") while it is on.

## Backup: terminal tools

Use these only if the admin page is unavailable. They run on your computer and need the admin
token. Before using them, set two values in your terminal for that session only:

```powershell
$env:SWOONY_ADMIN_URL = "https://swoony.chat"
$env:SWOONY_ADMIN_TOKEN = "<paste from your password manager>"
```

Close the terminal when you are done. If a script says "Not found", the URL or token is wrong,
or you made more than 10 calls in a minute (wait one minute). Terminal actions are written to
the Activity log too, as "cli" and without a case reference: note the reference in the request
log.

| Tool | Example |
|---|---|
| Look up | `node scripts/legal/lookup.ts --nickname mika --from 2026-11-01 --to 2026-11-19` |
| Ban | `node scripts/legal/ban.ts --user <userId>` |
| Take down | `node scripts/legal/takedown.ts --chat <chatId>` |
| Hold | `node scripts/legal/hold.ts --user <userId> --until 2027-12-31` |

Dates and times are UTC, which is 8 hours behind Philippine time (PHT). A date alone means the
whole day: `--from 2026-11-19` starts at 00:00 UTC and `--to 2026-11-19` ends at 23:59:59 UTC.
For an exact time, write it with a zone, for example `2026-11-19T14:30+08:00` for 2:30 pm PHT.
A notice dated in PHT can fall on the previous UTC day, so start the range one day earlier.

Add `--csv <file>` to a lookup to also save the connection records as a spreadsheet file, for
example `--csv $HOME\swoony-legal\response.csv` (create the folder once with
`mkdir $HOME\swoony-legal`). The lookup output lists `userId` values (needed for ban and hold)
and `chatId` values (needed for take down and hold).
