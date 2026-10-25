-- CreateTable
CREATE TABLE "LeagueSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leagueSlug" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "LeagueSnapshot_leagueSlug_key" ON "LeagueSnapshot"("leagueSlug");
