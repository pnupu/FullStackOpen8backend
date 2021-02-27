const { ApolloServer, gql, AuthenticationError, UserInputError } = require('apollo-server')
const jwt = require('jsonwebtoken')
require('dotenv').config()
const mongoose = require('mongoose')
const Book = require('./models/book')
const Author = require('./models/author')
const User = require('./models/user')
const { PubSub } = require('apollo-server')
const pubsub = new PubSub()

const JWT_SECRET = 'Bearer eyJhbGciOiJIUzI1NiIsInR5c2VybmFtZSI6Im1sdXVra2FpIiwiaW' 

const MONGODB_URI = process.env.mongoUrl

console.log('Connecting to: ', MONGODB_URI)

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false, useCreateIndex: true })
  .then(() => {
    console.log('connected to MongoDB')
  })
  .catch((error) => {
    console.log('error connecting to MongoDB:', error.message)
  })

const typeDefs = gql`
  type Author {
    name: String!
    born: Int
    bookCount: Int
    id: ID!
  }

  type Book {
    title: String!
    published: Int!
    author: Author!
    genres: [String!]!
    id: ID!
  }

  type User {
    username: String!
    favoriteGenre: String!
    id: ID!
  }
  
  type Token {
    value: String!
  }
  
  type Query {
      authorCount: Int!
      bookCount: Int!
      allBooks(author: String, genre: String): [Book!]!
      allAuthors: [Author!]!
      me: User
  }

  type Mutation {
    addBook(
      title: String!
      published: Int!
      author: String!
      genres: [String!]!
    ): Book
    editAuthor(
      name: String!
      setBornTo: Int!
    ): Author
    createUser(
      username: String!
      favoriteGenre: String!
    ): User
    login(
      username: String!
      password: String!
    ): Token
  }

  type Subscription {
    bookAdded: Book!
  }

`



const resolvers = {
  Query: {
    authorCount: () => Author.collection.countDocuments(),
    bookCount: (root, args) => {
      if(!args){
        return Book.collection.countDocuments() 
      }
      return Book.collection.countDocuments({author: args.author}) 
    },
    allBooks: (root, args) => {
      let modBooks = Book.find({})
      if(!args){
        return Book.find({})
      }
      if(args.author){
        modBooks = Book.find({ author: args.author})
      }
      if(args.genre){
        return Book.find({ genres: { $in: [args.genre] }})
      }
      return modBooks
    },
    allAuthors: async (root, args) => {
      return await Author.find({}).populate('bookCount')

    },
    me: (root, args, context) => {
      return context.currentUser
    }
    
  },
  Book: {
    author: async (root, args) => {
      const aut = await Book.findOne({ title: root.title})
      const author = await Author.findOne({ _id: aut.author})
      return {
        name: author.name,
        born: author.born,
        id: author._id,
        bookCount: author.bookCount
      }
      
    }
  },
  Mutation: {
    addBook: async (root, args, context) => {
      const aut = await Author.findOne({ name:  args.author})
      const currentUser = context.currentUser
      if(!currentUser) {
        throw new AuthenticationError("not authenticated")
      }

      if(!aut){
        const newAuthor = new Author({
          name: args.author
        })
        try{
          await newAuthor.save()
        } catch (error) {
          throw new UserInputError(error.message, {
            invalidArgs: args,
          })
        }
      }

      const author = await Author.findOne({ name:  args.author})
      const book = new Book({...args, author: author})
      try {
        await book.save()
        
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        })
      }
      pubsub.publish('BOOK_ADDED', { bookAdded: book })
      return book
    },
    editAuthor: async (root, args, context) => {
      const currentUser = context.currentUser
      if(!currentUser) {
        throw new AuthenticationError("not authenticated")
      }
      if(!Author.findOne({name: args.name})){
        return null
      }
      const author = await Author.findOne({name: args.name})
      author.born = args.setBornTo
      try {
        await author.save()
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        })
      }
      return author
    }, 
    createUser: async (root, args) => {
      const user = new User({ 
        username: args.username,
        favoriteGenre: args.favoriteGenre,
      })

      return user.save()
        .catch( error => {
          throw new UserInputError(error.message, {
            invalidArgs: args,
          })
        })
    },
    login: async (root, args) => {
      const user = await User.findOne({ username: args.username })

      if( !user || args.password !== "salasana") {
        throw new UserInputError("wrong credentials")
      }

      const userForToken = {
        username: user.username,
        id: user._id,
      }

      return { value: jwt.sign(userForToken, JWT_SECRET)}
    }
  },
  Subscription: {
    bookAdded: {
      subscribe: () => pubsub.asyncIterator(['BOOK_ADDED'])
    },
  },

  
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: async ({ req }) => {
    const auth = req ? req.headers.authorization : null
    if(auth && auth.toLowerCase().startsWith('bearer ')) {
      const decodedToken = jwt.verify(
        auth.substring(7), JWT_SECRET
      )
      const currentUser = await User
        .findById(decodedToken.id)
      return { currentUser }
    }
  }
})

server.listen().then(({ url, subscriptionsUrl }) => {
  console.log(`Server ready at ${url}`)
  console.log(`Subscription ready at ${subscriptionsUrl}`)
})