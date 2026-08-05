# QLess — Test Credentials (frontend mock)

Auth is fully mocked (no backend). Any input works:

- **Login:** any email/username + any password → logs in as demo user "Aarav Patel".
- **Guest:** "Find CNG Near Me" on the landing enters the app as a guest (no login).

Session + all data (alerts, saved stations, reports, theme, location) persist in
browser `localStorage`. Clear localStorage to reset to seed data and see the landing again.
