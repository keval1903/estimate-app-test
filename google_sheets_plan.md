# Google Sheets Product Master Sync Plan (Add Stock Update)

This plan outlines how to make a Google Sheet the master controller for your app's products, with a safe mechanism to **add new stock** and view the live stock without overwriting live billing deductions.

## Architecture & Data Flow

1. **The Google Sheet Template**: The Sheet will contain your basic product columns (`ID`, `Product Name`, `Rate`, `Unit`, `Calculation Type`, `Is Active`). 
   - **`Current Stock` (Read-Only)**: This column will exist so you can see the total value, but the script will know *never* to push this number to the database.
   - **`Add Stock (+)`**: You will use this column to add new inventory safely.
2. **Google Apps Script (The Bridge)**: We will write a custom script directly inside your Google Sheet.
3. **Supabase REST API / RPC**: The script will securely communicate with your Supabase database using your `URL` and `Service Role Key`.

## The "Add Stock" Workflow
This perfectly solves the risk of overwriting live billing stock while still letting you see the totals:
1. When a new shipment arrives, you open the Google Sheet.
2. In the `Add Stock (+)` column next to the product, you type `50`.
3. You click the **"Sync to App"** button at the top of the sheet.
4. **Push Phase**: The script tells the database: *"Take the current live stock for this product and add 50 to it."* The database records exactly when and how much stock was added into a `stock_history` table.
5. **Pull Phase**: The script then asks the database for the newly updated total stock numbers, and refreshes the `Current Stock` column in your Google Sheet so you instantly see the new live total.
6. Finally, the script automatically **clears out** the `Add Stock (+)` column in your Google Sheet.

## Implementation Steps
1. **Database Prep**: 
   - Ensure the `is_active` boolean column exists.
   - Create a secure database function (RPC) in Supabase called `add_stock` that securely adds the number to the live stock and writes to the `stock_history` table.
2. **Sheet Creation**: I will provide you with the exact column layout and the custom Script for your Google Sheet.
3. **App Update**: Ensure the app filters out any products marked `is_active = false`.
