SELECT m.id, m."stakeUsd" AS stake, m."winnerId" AS winner, m."player1Id" AS p1, m."player2Id" AS p2, m.meta->>'lockP1' AS lockp1, r."commissionPct" AS pct
FROM "Match" m JOIN "Room" r ON r.id=m."roomId"
WHERE (m."player1Id"=23 OR m."player2Id"=23) AND m.status='FINISHED'
ORDER BY m.id DESC LIMIT 8;

SELECT l.id, l."userId" u, l.amount::text amt, l.type, l."refId" rid
FROM "Ledger" l WHERE l."userId"=23 AND l."refType"='match'
ORDER BY l.id DESC LIMIT 16;
