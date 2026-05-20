/**
 * seed-admins.js — One-time Admin Seeding Script
 *
 * Run this ONCE to create the two admin accounts in Firebase Auth
 * and seed their user documents in Firestore.
 *
 * PREREQUISITES:
 *   1. npm install firebase-admin
 *   2. Download your Firebase service account key JSON from:
 *      Firebase Console → Project Settings → Service Accounts → Generate New Private Key
 *   3. Save it as "service-account-key.json" in this /scripts/ folder
 *   4. Run: node scripts/seed-admins.js
 *
 * ⚠️ DO NOT commit service-account-key.json to version control.
 * ⚠️ DO NOT run this script more than once (it will error on duplicate emails).
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Admin SDK
const serviceAccount = require(path.join(__dirname, 'service-account-key.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const authAdmin = admin.auth();
const dbAdmin = admin.firestore();

const ADMINS = [
  {
    email: 'tabukochessclub@admin.tabuko.local',
    displayName: 'Tabuko Chess Club Admin',
    password: 'Tabukochess2008'
  },
  {
    email: 'jesstergirado@admin.tabuko.local',
    displayName: 'Jesster Girado',
    password: 'Tabukochess2008'
  }
];

async function seed() {
  console.log('🔐 Seeding admin accounts...\n');

  for (const adminUser of ADMINS) {
    try {
      // Create the user in Firebase Auth
      const userRecord = await authAdmin.createUser({
        email: adminUser.email,
        password: adminUser.password,
        displayName: adminUser.displayName,
        emailVerified: true
      });

      console.log(`✅ Created auth user: ${adminUser.email}`);
      console.log(`   UID: ${userRecord.uid}`);

      // Create matching Firestore document
      await dbAdmin.collection('users').doc(userRecord.uid).set({
        uid: userRecord.uid,
        email: adminUser.email,
        displayName: adminUser.displayName,
        role: 'admin',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`   Firestore document created.\n`);

    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        console.log(`⚠️  User ${adminUser.email} already exists. Skipping.`);
        // Fetch existing UID for reference
        const existing = await authAdmin.getUserByEmail(adminUser.email);
        console.log(`   Existing UID: ${existing.uid}\n`);
      } else {
        console.error(`❌ Error creating ${adminUser.email}:`, err.message);
      }
    }
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('IMPORTANT: Copy the two UIDs above and paste them into firestore.rules');
  console.log('Replace ADMIN_UID_1 and ADMIN_UID_2 with the actual UIDs.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  process.exit(0);
}

seed();
