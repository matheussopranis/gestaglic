const { neon } = require('@neondatabase/serverless');

exports.handler = async (event, context) => {
  // Conecta ao banco usando a variável que você configurou no Netlify
  const sql = neon(process.env.DATABASE_URL);

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    // --- ROTA 1: LOGIN SIMPLIFICADO ---
    // Se a ação for 'login', procuramos o usuário pelo CPF + Data.
    // Se não existir, criamos um novo na hora.
    if (event.httpMethod === 'POST' && body.action === 'login') {
      const { cpf, dob } = body;

      if (!cpf || !dob) {
        return { statusCode: 400, body: "CPF e Data são obrigatórios" };
      }

      // 1. Tenta achar o usuário
      let user = await sql`
        SELECT user_id FROM usuarios 
        WHERE cpf_prefixo = ${cpf} AND nascimento = ${dob}
        LIMIT 1
      `;

      // 2. Se não achar, CRIA automaticamente
      if (user.length === 0) {
        user = await sql`
          INSERT INTO usuarios (cpf_prefixo, nascimento)
          VALUES (${cpf}, ${dob})
          RETURNING user_id
        `;
      }

      // Retorna o ID único para o site guardar
      return {
        statusCode: 200,
        body: JSON.stringify({ user_id: user[0].user_id })
      };
    }

    // --- ROTA 2: OPERAÇÕES DE DADOS (GET, POST, DELETE) ---
    // Para mexer nos dados, o site precisa mandar o ID do usuário no cabeçalho (Header)
    const userId = event.headers['x-user-id'];

    if (!userId) {
      return { statusCode: 401, body: "Não autorizado. Faça login novamente." };
    }

    // LISTAR (GET)
    if (event.httpMethod === 'GET') {
      const rows = await sql`
        SELECT id_registro, data_log, valor, momento, status 
        FROM registros_glicemia 
        WHERE user_id = ${userId}
        ORDER BY data_log DESC, id_registro DESC
      `;
      
      const formatted = rows.map(r => ({
        id: r.id_registro,
        date: r.data_log.toISOString().split('T')[0], // Formata data YYYY-MM-DD
        value: r.valor,
        momento: r.momento,
        status: r.status
      }));

      return { statusCode: 200, body: JSON.stringify(formatted) };
    }

    // SALVAR NOVO REGISTRO (POST)
    if (event.httpMethod === 'POST' && !body.action) {
      await sql`
        INSERT INTO registros_glicemia (user_id, data_log, valor, momento, status)
        VALUES (${userId}, ${body.date}, ${body.value}, ${body.momento}, ${body.status})
      `;
      return { statusCode: 201, body: JSON.stringify({ message: "Salvo" }) };
    }

    // DELETAR (DELETE)
    if (event.httpMethod === 'DELETE') {
      const { id } = JSON.parse(event.body);
      await sql`DELETE FROM registros_glicemia WHERE id_registro = ${id} AND user_id = ${userId}`;
      return { statusCode: 200, body: JSON.stringify({ message: "Deletado" }) };
    }

    return { statusCode: 405, body: "Método não permitido" };

  } catch (error) {
    console.error("Erro API:", error);
    // Retorna o erro detalhado para aparecer no alerta do site se algo der errado
    return { statusCode: 500, body: `Erro no Banco: ${error.message}` };
  }
};