# Security policy

## Supported versions

Only the latest release of the AppTable Elior integration receives security fixes.
Update the integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-apptable-elior](https://github.com/prohand/gladys-apptable-elior/security),
then **Report a vulnerability**.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove emails, passwords, tokens and children's names first).

You should get a first answer within 7 days. A fix is released as a new version of
the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes — in
particular how the AppTable password and the session tokens are handled (they must
never be logged, stored outside Gladys' secret field, or sent anywhere but the
AppTable API over HTTPS).

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)) and the
AppTable service run by Elior (report to Elior).

## Good practices for users

- Keep the AppTable password only in the integration's secret field.
- Use a password you do not reuse elsewhere.
- Keep Gladys and the integration up to date.
