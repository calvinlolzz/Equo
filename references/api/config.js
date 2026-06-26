module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    supabase: {
      configured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
      url: process.env.SUPABASE_URL || "",
      anonKey: process.env.SUPABASE_ANON_KEY || ""
    },
    admin: {
      enabled: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
    }
  });
};
