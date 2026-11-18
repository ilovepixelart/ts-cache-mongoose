import mongoose, { Schema } from 'mongoose'

// Fixtures with fixed ids and values, so that results are the same on every run and every version.

const T = Schema.Types

export const oid = (n: number): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(n.toString(16).padStart(24, '0'))

// UUID is a schema type from mongoose 8 on.
export const hasUUID = 'UUID' in T

const authorSchema = new Schema({ name: String })

const bookDefinition: Record<string, unknown> = {
  title: String,
  genre: String,
  pages: Number,
  tags: [String],
  reviews: [new Schema({ by: String, stars: Number })],
  publisher: new Schema({ name: String, city: String }, { _id: false }),
  author: { type: T.ObjectId, ref: 'Author' },
  price: T.Decimal128,
  cover: Buffer,
  attrs: { type: Map, of: String },
  published: Date,
  status: { type: String, default: 'draft' },
  secret: { type: String, select: false, default: 'hidden' },
}
if (hasUUID) bookDefinition.isbn = (T as unknown as Record<string, unknown>).UUID

const bookSchema = new Schema(bookDefinition)

export type Book = {
  _id: mongoose.Types.ObjectId
  title: string
  genre: string
  pages: number
  tags: string[]
  author?: unknown
}

export const models = (connection: mongoose.Connection) => ({
  Author: connection.model('Author', authorSchema),
  Book: connection.model<Book>('Book', bookSchema),
})

const books = [
  {
    _id: oid(11),
    title: 'Alpha',
    genre: 'fantasy',
    pages: 300,
    tags: ['magic', 'quest'],
    reviews: [{ _id: oid(101), by: 'kim', stars: 4 }],
    publisher: { name: 'North', city: 'Oslo' },
    author: oid(1),
    price: '12.50',
    cover: Buffer.from([1, 2, 3]),
    attrs: { lang: 'en' },
    published: new Date('2020-01-02T03:04:05.006Z'),
    isbn: '09190f70-3d30-11e5-8814-0f4df9a59c41',
  },
  {
    _id: oid(12),
    title: 'Beta',
    genre: 'fantasy',
    pages: 120,
    tags: [],
    reviews: [],
    author: oid(2),
    price: '0.10',
    published: new Date('2021-05-06T07:08:09.010Z'),
  },
  {
    _id: oid(13),
    title: 'Gamma',
    genre: 'scifi',
    pages: 500,
    tags: ['space'],
    reviews: [{ _id: oid(102), by: 'lee', stars: 5 }],
    publisher: { name: 'South', city: 'Lima' },
    author: oid(1),
    price: '7.00',
    attrs: { lang: 'es', format: 'paper' },
    published: new Date('2019-09-10T11:12:13.014Z'),
  },
]

export const seed = async (connection: mongoose.Connection, titlePrefix = ''): Promise<void> => {
  const { Author, Book } = models(connection)
  await Author.deleteMany({})
  await Book.deleteMany({})
  await Author.create([
    { _id: oid(1), name: 'Ann' },
    { _id: oid(2), name: 'Bob' },
  ])
  await Book.create(books.map((book) => ({ ...book, title: `${titlePrefix}${book.title}` })))
}
