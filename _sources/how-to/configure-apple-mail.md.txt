# Configure Apple Mail Compatibility

**Fix IMAP folder hierarchy issues with Apple Mail (iOS/macOS) by changing the Dovecot namespace separator.**

## Problem

Apple Mail clients have known compatibility issues with the default IMAP namespace hierarchy separator (`.`) used by Dovecot in Mailu. Symptoms include:

- Folders not syncing correctly on iOS/macOS
- Folder hierarchy displayed incorrectly
- Folders with `.` in the name misinterpreted as nested hierarchy

## Solution

Set the Dovecot namespace separator to `/`:

```typescript
const config: MailuChartConfig = {
  // ... other config ...
  dovecot: {
    namespaceSeparator: '/',
  },
};
```

This creates a Dovecot override configuration mounted at `/overrides/dovecot.conf` that sets:

```
namespace inbox {
  separator = /
}
```

## Warnings

```{warning}
**Do not change on production systems without a backup.** Existing folders containing `/` in their name will be reinterpreted as hierarchical folders.
```

- **Sieve filters may break** - Server-side mail filtering rules reference folder names using the separator
- **Client reconfiguration required** - All connected mail clients should remove and re-add the account
- **Not easily reversible** - Reverting the change carries the same risks as applying it

## Verification

After deploying the change, verify the separator with a raw IMAP connection:

```bash
openssl s_client -connect mail.example.com:993
a login user@domain password
a list "" "*"
# Should show "/" instead of "." as separator
```

Expected output:

```
* LIST (\HasNoChildren \UnMarked) "/" Notes
* LIST (\HasNoChildren \UnMarked) "/" "Deleted Messages"
```

## References

- [Dovecot Namespace Documentation](https://doc.dovecot.org/main/core/config/namespaces.html)
- [Mailu Issue #2399](https://github.com/Mailu/Mailu/issues/2399)
- [Mailu Discussion #3089](https://github.com/Mailu/Mailu/discussions/3089)
