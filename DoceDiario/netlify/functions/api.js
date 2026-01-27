const { neon } = require('@neondatabase/serverless');

exports.handler = async (event, context) => {
  const sql = neon(process.env.DATABASE_URL);

  try {
    // --- SEGURO ANTI-ERRO: Cria as tabelas se elas não existirem ---
    // Isso garante que o banco esteja pronto, mesmo se você esqueceu o SQL.
    await sql`
      CREATE TABLE IF NOT EXISTS usuarios (
          user_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          cpf_prefixo TEXT NOT NULL,
          nascimento TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login ON usuarios(cpf_prefixo, nascimento);
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS registros_glicemia (
          id_registro SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          data_log DATE NOT NULL,
          valor INTEGER NOT NULL,
          momento TEXT NOT NULL,
          status TEXT
      );
    `;
    // -----------------------------------------------------------

    const body = event.body ? JSON.parse(event.body) : {};

    // --- ROTA DE LOGIN ---
    if (event.httpMethod === 'POST' && body.action === 'login') {
      const { cpf, dob } = body;

      if (!cpf || !dob) return { statusCode: 400, body: "CPF e Data obrigatórios" };

      // Busca usuário
      let user = await sql`
        SELECT user_id FROM usuarios 
        WHERE cpf_prefixo = ${cpf} AND nascimento = ${dob}
        LIMIT 1
      `;

      // Se não existe, cria
      if (user.length === 0) {
        user = await sql`
          INSERT INTO usuarios (cpf_prefixo, nascimento)
          VALUES (${cpf}, ${dob})
          RETURNING user_id
        `;
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ user_id: user[0].user_id })
      };
    }

    // --- ROTAS DE DADOS ---
    const userId = event.headers['x-user-id'];
    if (!userId) return { statusCode: 401, body: "Login necessário" };

    if (event.httpMethod === 'GET') {
      const rows = await sql`
        SELECT id_registro, data_log, valor, momento, status 
        FROM registros_glicemia 
        WHERE user_id = ${userId}
        ORDER BY data_log DESC
      `;
      // Formata datas para evitar erro no frontend
      const formatted = rows.map(r => ({
          ...r,
          id: r.id_registro,
          date: new Date(r.data_log).toISOString().split('T')[0]
      }));
      return { statusCode: 200, body: JSON.stringify(formatted) };
    }

    if (event.httpMethod === 'POST') {
      await sql`
        INSERT INTO registros_glicemia (user_id, data_log, valor, momento, status)
        VALUES (${userId}, ${body.date}, ${body.value}, ${body.momento}, ${body.status})
      `;
      return { statusCode: 201, body: JSON.stringify({ msg: "Salvo" }) };
    }

    if (event.httpMethod === 'DELETE') {
      const { id } = JSON.parse(event.body);
      await sql`DELETE FROM registros_glicemia WHERE id_registro = ${id} AND user_id = ${userId}`;
      return { statusCode: 200, body: JSON.stringify({ msg: "Deletado" }) };
    }

    return { statusCode: 405, body: "Método inválido" };

  } catch (error) {
    console.error("ERRO CRÍTICO:", error);
    return { statusCode: 500, body: `Erro no Servidor: ${error.message}` };
  }
};