SELECT id, status, "externalId", "createdAt", "finishedAt" FROM "Payment" WHERE provider = 'betra' ORDER BY "createdAt" DESC LIMIT 8;
