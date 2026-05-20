# Firestore Schema — Tabuko Chess Club

## Collections

### `users`
```json
{
  "uid": "string (auth UID)",
  "email": "string",
  "displayName": "string",
  "role": "admin | arbiter | player",
  "createdAt": "timestamp"
}
```

### `players`
```json
{
  "id": "string (auto)",
  "name": "string",
  "ratings": {
    "fide": "number | null",
    "ncfp": "number | null",
    "club": "number | null"
  },
  "estimatedRating": "number | null",
  "createdAt": "timestamp"
}
```

### `teams`
```json
{
  "teamId": "string (auto)",
  "teamName": "string",
  "tournamentId": "string",
  "players": [
    {
      "id": "string",
      "name": "string",
      "rating": "number",
      "boardNumber": "number (1-based, fixed)"
    }
  ],
  "matchPoints": "number (0)",
  "boardPoints": "number (0)",
  "opponents": ["teamId strings"],
  "teamResults": [
    { "opponentTeamId": "string", "matchResult": "number (0/1/2)", "boardResult": "number" }
  ],
  "hadBye": "boolean",
  "withdrawn": "boolean"
}
```

### `tournaments`
```json
{
  "id": "string (auto)",
  "name": "string",
  "type": "swiss | round-robin",
  "status": "registration | active | completed",
  "currentRound": "number",
  "totalRounds": "number",
  "ratingType": "fide | ncfp | club | custom",
  "unratedHandling": "lowest | fixed | estimated",
  "defaultRating": "number",
  "tieBreakOrder": ["string array — ordered tie-break identifiers"],
  "resolutionConfig": {
    "additionalTieBreaks": ["string array"],
    "allowPlayoff": "boolean",
    "allowRandom": "boolean"
  },
  "isTeamEvent": "boolean",
  "teamSize": "number",
  "teamRatingMethod": "average | total",
  "playerIds": ["player ID strings"],
  "teamIds": ["team ID strings"],
  "createdBy": "string (user UID)",
  "createdAt": "timestamp"
}
```

### `tournaments/{id}/rounds/round_{N}`
```json
{
  "roundNumber": "number",
  "status": "active | completed",
  "pairings": [
    {
      "board": "number",
      "whiteId": "string",
      "blackId": "string",
      "whiteName": "string",
      "blackName": "string",
      "result": { "whiteScore": "number", "blackScore": "number" } | null
    }
  ],
  "bye": { "playerId": "string", "playerName": "string" } | null,
  "isTeamRound": "boolean (optional)",
  "matches": "(team format — array of team match objects)",
  "createdAt": "timestamp"
}
```

### `tournaments/{id}/standings_cache/current`
```json
{
  "tournamentId": "string",
  "standings": [
    {
      "playerId": "string",
      "rank": "number",
      "name": "string",
      "score": "number",
      "tieBreaks": { "buchholzFull": 0, "sonnebornBerger": 0, "..." : 0 },
      "tieResolvedBy": "string"
    }
  ],
  "updatedAt": "ISO string",
  "version": "number (timestamp)"
}
```

## Tie-Break Identifiers

| Key | Description |
|---|---|
| `buchholzFull` | Sum of all opponents' scores |
| `buchholzCut1` | Buchholz minus lowest opponent |
| `buchholzCut2` | Buchholz minus two lowest opponents |
| `buchholzMedian` | Buchholz minus highest and lowest |
| `sonnebornBerger` | Sum of (result × opponent score) |
| `directEncounter` | Head-to-head result |
| `wins` | Total number of wins |
| `progressiveScore` | Sum of cumulative round scores |
| `performanceRating` | Avg opponent rating + dp lookup |
| `koya` | Score vs opponents with ≥50% |
| `rating` | Player's selected rating |
| `blackGames` | Number of games as black |

## Deployment

```bash
npm install -g firebase-tools
firebase login
firebase init  # Select Hosting + Firestore
# Update firebase-config.js with your project credentials
firebase deploy
```
