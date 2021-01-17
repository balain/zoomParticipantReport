CREATE TABLE "history" (
	"id"	INTEGER NOT NULL,
	"uuid"	TEXT NOT NULL,
	"start_time"	TEXT NOT NULL,
	PRIMARY KEY("uuid","id")
);

CREATE TABLE "attendees" (
	"meetingId"	INTEGER,
	"meetingInstance"	TEXT,
	"id"	TEXT,
	"user_id"	TEXT NOT NULL,
	"name"	TEXT,
	"user_email"	TEXT,
	"join_time"	TEXT NOT NULL,
	"leave_time"	TEXT NOT NULL,
	"duration"	INTEGER NOT NULL
);