
---

name: Skills Creator

description: "Guide for creating effective skills. Apply when creating or updating skills that extend capabilities with specialized knowledge, workflows, or tool integrations."

---

## Rules:

1. must read the whole file first, then make a plan how to finish this, at last finish it.

## Steps:

1.  Summary the skill request and make an empty  folder named this summary.
**Examples**:  
**Q**: When input the request with "follow the chat history in this session, give a skill to get the cookie"
**A**: summary the chat and then make a empty folder named `get-cookie-skill`

2. Make the folder structure like:
```

skill-name/

├── SKILL.md (required)

├── scripts/          - Executable code (Python/Bash/etc.)

├── references/       - Documentation intended to be loaded into context as needed

└── assets/           - Files used in output (templates, icons, fonts, etc.)

```

3. Fulfill the SKILL.md, and must follow this structure:
```
---
name: XXX

description: XXX(when to use)

---

### Steps:(Each step to follow)

### Boundary:(the rights this skill have and should not do)

### Output:(the result should output)
```

4. Give some simple examples for each `Steps/Boundary/Output` in  SKILL.md

5. Make core scripts you used in `skill-name/scripts` and each script should be generic and can be re-used by the skills.

6. Some rules or references you used should be in `skill-name/references`

7. If the output is a file, you should output it in `skill-name/assets`


## Boundary

1. You have the right to new a file and folder
2. If you find some skills that already had, you should updated it not new one.
