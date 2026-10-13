-- 012 — "it" permission: the IT category (List, Board, My queue, systems'
-- tickets). Every existing role gets it, so nobody loses tickets on deploy.

UPDATE roles
SET permissions = CASE WHEN permissions = '' THEN 'it' ELSE permissions || ',it' END
WHERE ',' || permissions || ',' NOT LIKE '%,it,%';
