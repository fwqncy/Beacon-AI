---
title: Engineering Onboarding Guide
team: engineering
---
@@ p.2
## Your first week

Day one is spent on laptop setup, security training and meeting your onboarding buddy. By the end of the first week you should have the development environment running, have merged a small "first PR" (usually a docs fix) and have shadowed one deploy.

Your manager will share a 30-60-90 day plan in your first 1:1.

@@ p.5
## Development environment

All services run locally with the `devbox` CLI. After cloning the monorepo, run `devbox up` to start Postgres, Redis and the core services in containers. Request access to the GitHub organisation and the staging cloud account in the IT portal under Requests → Access; access is approved by your team lead.

Production access is not granted during the first 30 days.

@@ p.8
## Code review

Every change needs at least one approving review from a code owner before merging. Keep pull requests under 400 changed lines where possible. Reviewers aim to respond within one working day. Changes to authentication, payments or data retention need a second reviewer from the Security guild.

@@ p.11
## On-call

Engineers join the on-call rotation after 3 months. Shifts are one week long, Monday 10:00 to Monday 10:00. On-call engineers receive an allowance of £300 per week, plus time off in lieu for any incident work over 2 hours outside working hours.

Page acknowledgement target is 15 minutes. Escalate to the secondary on-call if you can't respond.
