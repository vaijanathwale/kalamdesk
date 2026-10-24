# KalamDesk — stationery shop billing + inventory
Stack: React (Vite) · Node/Express · MySQL · Python FastAPI (AI)

## Run
1. MySQL: `mysql -u root -p < backend/schema.sql`
2. AI:  `cd ai-service && pip install -r requirements.txt && uvicorn main:app --port 8000`
3. API: `cd backend && cp .env.example .env && npm i && npm start`  (port 4000)
4. UI:  `cd frontend && npm i && npm run dev`  (port 5173)
First user to register becomes `owner`; later ones are `staff` (owner-only: delete products/sets, AI).

## Features
- Inventory: add/edit/remove items, stock, GST %, low-stock alerts
- Book sets: one set per class (Nursery–12th); click a class -> all books load into the bill; add/remove extras per sale, or edit the set itself
- Billing: stock auto-deducts, PDF invoice, print, download, email, WhatsApp (wa.me link; swap for WhatsApp Cloud API later)
- Auth: JWT + bcrypt, roles
- AI: reorder suggestions from sales history (moving-average demand forecast)
