# PUP QR Attendance & Class Management System (v2.0)

A comprehensive, enterprise-grade attendance tracking and classroom management web application for the Polytechnic University of the Philippines (PUP). Featuring real-time dynamic QR attendance validation, session-based attendance tracking, role-based dashboards (Admin, Professor, Student), interactive multi-filter reports with dynamic pie breakdowns, offline check-in queuing, and audit logging.

---

## 📥 How to Download / Export This Project

If you are viewing this project in Google AI Studio:
1. Locate the header / top menu bar.
2. Click the **Export** or **Download** / **Save to GitHub** button.
3. Choose **Download ZIP** or **Export to GitHub Repository** to save the repository to your local machine.

---

## 🚀 Quick Start & Local Setup

### Prerequisites
- **Node.js**: v18.0.0 or higher ([nodejs.org](https://nodejs.org))
- **npm**: v8.0.0 or higher (comes bundled with Node.js)
- **Python 3**: (Optional, used for on-the-fly zip packaging)

### 1. Extract the Project
If you downloaded the `.zip` archive:
```bash
unzip pup-attendance-system.zip -d pup-attendance-system
cd pup-attendance-system
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Initialize & Seed Database
The application uses SQLite (`data/attendance.db`). You can initialize and seed demo accounts, courses, and attendance logs:
```bash
npm run seed
```

### 4. Start the Application
Run the production server:
```bash
npm start
```
Or start in development mode with auto-reload:
```bash
npm run dev
```

The system will start running at:
```
http://localhost:3000
```
Open `http://localhost:3000` in any modern web browser (Chrome, Firefox, Edge, Safari).

---

## 🔑 Default Demo Accounts

After running `npm run seed`, you can log in with any of the following pre-configured accounts:

| Role | Username | Password | Notes |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin` | `adminpassword` | Institutional overview, user management, audit logs, system backups |
| **Professor** | `faculty` | `profpass` | Session management, QR generation, multi-filter reporting & pie charts |
| **Student** | `student1` | `stud123` | Attendance scanner, schedule view, excuse submission |
| **Student** | `student2` | `stud123` | Enrolled in CS courses |

---

## 🌟 Key Features

1. **Dashboard Simpler Pie Attendance Graph**:
   - Clean, high-contrast categorical attendance breakdown right on the professor and admin dashboards.
   - Shows live Present %, Late %, Absent %, and Excused % with color-coded badges and hover tooltips.

2. **Multi-Select Dynamic Filter & Pie Visualization in Reports**:
   - Multi-select quick filter buttons (`Present`, `Late`, `Absent`, `Excused`, `At-Risk`).
   - Clicking multiple filters showcases **only the selected categories** dynamically in the Doughnut/Pie chart with center totals and proportion calculations.
   - Clicking legend items toggles individual slices in and out of the multi-filter view.

3. **Secure Dynamic QR Attendance**:
   - Auto-refreshing rotating cryptographic QR codes prevent proxy attendance.
   - Dynamic room-code verification and hybrid/online continuity monitoring.

4. **Offline Capability & PWA Ready**:
   - Progressive Web App support with service worker caching.
   - Offline check-in queueing: marks attendances locally when internet is disconnected and auto-syncs when online.

5. **Reporting & Data Export**:
   - Clean institutional PDF export with letterhead.
   - Excel / CSV spreadsheet export for official grade and attendance submissions.

---

## 📁 Project Architecture

```
.
├── backend/
│   ├── routes/              # Express API routers (auth, attendance, users)
│   ├── services/            # Core business logic (attendance, auth)
│   ├── utils/               # Error handling, sanitizers
│   ├── auth.js              # JWT auth and RBAC middleware
│   ├── db.js                # SQLite database connection & migrations
│   ├── seed.js              # Database seeder with sample data
│   └── server.js            # Main Express server entrypoint
├── data/
│   └── attendance.db        # SQLite database file
├── frontend/
│   ├── css/                 # Global styles and Tailwind utility classes
│   ├── js/                  # API client, QR scanner, schedule engine
│   ├── index.html           # Main Dashboard (Trends, Simpler Pie Chart)
│   ├── reports.html         # Multi-filter Reports & Dynamic Pie breakdown
│   ├── scanner.html         # Camera QR code scanner
│   ├── live-session.html    # Real-time classroom session management
│   ├── admin.html           # Admin administration console
│   └── ...
├── metadata.json            # AI Studio app metadata
├── package.json             # Node dependencies and scripts
└── README.md                # System documentation
```

---

## 🛠️ Environment Variables (Optional)

Configure custom options in `.env`:
```env
PORT=3000
JWT_SECRET=your-secure-jwt-secret-key
QR_SECRET=your-secure-qr-secret-key
```

---

## 📄 License
This project is licensed under the MIT License.
