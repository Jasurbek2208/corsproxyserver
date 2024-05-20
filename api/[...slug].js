import app from './server'

export default async (req, res) => {
    await app(req, res);
};