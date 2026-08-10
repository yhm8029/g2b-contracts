import { createDb } from "@/lib/db/client";
import { initializeSqliteSchema } from "@/lib/db/init";
import { excellentProductsToCsv } from "@/lib/excellent-products/export";
import { getBuildingControlExcellentProducts } from "@/lib/excellent-products/repository";

export const runtime = "nodejs";

export async function GET() {
  let connection: ReturnType<typeof createDb> | undefined;
  try {
    connection = createDb();
    initializeSqliteSchema(connection.sqlite);
    const result = getBuildingControlExcellentProducts(connection.db);
    const csv = excellentProductsToCsv(result.items);
    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition":
          'attachment; filename="g2b-excellent-products-39121801.csv"',
      },
    });
  } catch {
    return Response.json({ error: "Excellent products export failed." }, { status: 500 });
  } finally {
    connection?.sqlite.close();
  }
}
