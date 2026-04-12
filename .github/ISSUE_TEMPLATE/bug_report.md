---
name: Bug report
about: Report a bug in ts-cache-mongoose
title: ''
labels: bug
assignees: ''

---

**Describe the bug**
A clear and concise description of what the bug is.

**Versions**
Describe your setup

- `ts-cache-mongoose`:
- `mongoose`:
- `ioredis`:
- Node.js:
- OS:

**Cache engine**

- [ ] in-memory
- [ ] redis
- [ ] both

**Minimal reproduction**
Schema, plugin options, and the query or aggregate pipeline that triggers the bug.

```typescript
// schema + plugin options
```

```typescript
// query or aggregate that reproduces the issue
```

**Expected behavior**
What you expected to happen (e.g. which result should have been cached, TTL behaviour, invalidation triggering).

**Actual behavior**
What happened instead. Include error messages and stack traces.

**Additional context**
Anything else that might help — related issues, Redis configuration, TTL specifics, etc.
