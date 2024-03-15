const express = require('express')
const app = express()
app.use(express.json())

const {open} = require('sqlite')
const sqlite3 = require('sqlite3')

const path = require('path')
const dbPath = path.join(__dirname, 'twitterClone.db')

const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

let db = null

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server Running at http://localhost')
    })
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(1)
  }
}
initializeDbAndServer()

//API 1 Register the user

app.post('/register/', async (request, response) => {
  const {userId, username, password, name, gender} = request.body
  const hashedPassword = await bcrypt.hash(request.body.password, 10)

  //check If the username already exists
  const usernameQuery = `
  SELECT username FROM user
  WHERE username = '${username}'; `
  const dbUsername = await db.get(usernameQuery)
  //check is the user exists or not
  if (dbUsername === undefined) {
    // Check for the possword length
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const addNewUserQuery = `
      INSERT INTO
        user(username,password,name,gender)
      VALUES ('${username}', '${hashedPassword}', '${name}', '${gender}');`
      const newUser = await db.run(addNewUserQuery)
      console.log(newUser)
      response.status(200)
      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

//API2 Login

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  let dbUser = null
  const checkForUsernameQuery = `
  SELECT * FROM user
  WHERE username="${username}";`
  dbUser = await db.get(checkForUsernameQuery)
  if (dbUser === undefined) {
    //user does not exists
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordValid = await bcrypt.compare(password, dbUser.password)

    if (isPasswordValid === true) {
      // Generate jwt Token
      const payload = {username: username}

      const jwtToken = jwt.sign(payload, 'My_Code')

      response.status(200)
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

//Authentication with JWT Token

const authenticationToken = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'My_Code', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        next()
      }
    })
  }
}

//get the user ID

const getUserId = async username => {
  const getUserIdQuery = `
    SELECT * FROM user
    WHERE username='${username}';`
  const userDetails = await db.get(getUserIdQuery)
  const userId = userDetails.user_id

  return userId
}
//API 3 Returns the latest tweets of people whom the user follows.
//Return 4 tweets at a time

app.get(
  '/user/tweets/feed/',
  authenticationToken,
  async (request, resposne) => {
    const {username} = request
    const userId = await getUserId(username)
    // get all the tweets inked to this ID.
    const getTheTweetsQuery = `
    SELECT user.name AS username , tweet.tweet AS tweet, tweet.date_time AS dateTime FROM (user
    INNER JOIN follower 
    ON user.user_id = follower.follower_user_id )AS T
    INNER JOIN tweet
    ON follower.following_user_id = tweet.user_id
    WHERE user.user_id= '${userId}'
    ORDER BY tweet.tweet_id DESC
    LIMIT 4;`

    const tweets = await db.all(getTheTweetsQuery)
    resposne.send(tweets)
  },
)

// API 4 Returns the list of all names of people whom the user follows
app.get('/user/following/', authenticationToken, async (request, response) => {
  const {username} = request
  const userId = await getUserId(username)
  console.log(userId)

  const getUserFollowingnamesQuery = `
  SELECT user.name AS name FROM (user
  INNER JOIN follower
  ON user.user_id = follower.follower_user_id)
  WHERE follower.following_user_id = '${userId}'
  ;`
  const userFollows = await db.all(getUserFollowingnamesQuery)
  response.send(userFollows)
})

//API 5 Returns the list of all names of people who follows the user

app.get('/user/followers/', authenticationToken, async (request, response) => {
  const {username} = request
  const userId = await getUserId(username)
  const getUserFollowersQuery = `
  SELECT user.name AS name FROM user
  INNER JOIN follower 
  ON user.user_id= follower.following_user_id
  WHERE follower.follower_user_id = '${userId}'
  `
  const userFollowers = await db.all(getUserFollowersQuery)
  response.send(userFollowers)
})

// user he is following
const isUserHeIsFollowing = async (tweetId, userId) => {
  const getTweetDetailsQuery = `
  SELECT * FROM tweet
  WHERE tweet_id = '${tweetId}';`
  const tweetDetails = await db.get(getTweetDetailsQuery)
  const userIdOfFollower = tweetDetails.user_id

  // whom the user is following
  const userFollower = `
  SELECT * FROM user
  INNER JOIN follower
  ON user.user_id = follower.follower_user_id
  WHERE follower.follower_user_id = '${userId}';
  `
  const tweetsList = await db.all(userFollower)
  const isFollowing = tweetsList.some(
    eachItem => eachItem.following_user_id === userIdOfFollower,
  )
  console.log(isFollowing)
  return isFollowing
}

//API 6 If the user requests a tweet other than the users he is following return Invalid Request
//If the user requests a tweet of the user he is following, return the tweet, likes count, replies count and date-time

app.get('/tweets/:tweetId/', authenticationToken, async (request, response) => {
  const {username} = request
  const {tweetId} = request.params
  const userId = await getUserId(username)
  const isFollowing = await isUserHeIsFollowing(tweetId, userId)

  if (isFollowing === true) {
    const getTheTweetDetailsQuery = `
    SELECT 
      tweet.tweet_id AS tweet,
      COUNT(*) AS replies,
      COUNT(*) AS likes,
      tweet.date_time AS dateTime
    FROM tweet
    INNER JOIN reply
    ON tweet.tweet_id = reply.tweet_id
    INNER JOIN like
    ON tweet.tweet_id = like.like_id
    WHERE tweet.tweet_id = '${tweetId}'
    GROUP BY tweet.tweet_id
    ;
    `
    const tweetsDetailsAPI6 = await db.all(getTheTweetDetailsQuery)
    response.send(tweetsDetailsAPI6)
  } else {
    response.status(401)
    response.send('Invalid Request')
  }
})

//API 7 If the user requests a tweet of a user he is following,
//return the list of usernames who liked the tweet

app.get(
  '/tweets/:tweetId/likes/',
  authenticationToken,
  async (request, response) => {
    const {username} = request
    const {tweetId} = request.params
    const userId = await getUserId(username)
    const isFollowing = await isUserHeIsFollowing(tweetId, userId)
    console.log(isFollowing)

    if (isFollowing === true) {
      const getUsernamesLikeTweetQuery = `
      SELECT 
      DISTINCT(name)
      FROM user
      INNER JOIN like
      ON user.user_id = like.user_id
      WHERE like.tweet_id = '${tweetId}';`
      const tweetsDetailsAPI7 = await db.all(getUsernamesLikeTweetQuery)
      const likes = tweetsDetailsAPI7.map(eachItem => eachItem.name)
      response.send({likes})
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)
// API 8 If the user requests a tweet of a user he is following,
//return the list of replies.

app.get(
  '/tweets/:tweetId/replies/',
  authenticationToken,
  async (request, response) => {
    const {username} = request
    const {tweetId} = request.params
    const userId = await getUserId(username)
    const isFollowing = await isUserHeIsFollowing(tweetId, userId)
    console.log(isFollowing)

    if (isFollowing === true) {
      const getRepliesListQuery = `
        SELECT 
          user.name AS name,
          reply.reply AS reply
         FROM user
        INNER JOIN reply
        ON user.user_id = reply.user_id
        WHERE reply.tweet_id = '${tweetId}'`
      const replies = await db.all(getRepliesListQuery)
      response.send({replies})
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

// API 9 Returns a list of all tweets of the user
app.get('/user/tweets/', authenticationToken, async (request, response) => {
  const {username} = request
  const userId = await getUserId(username)
  const getUserTweetsList = `
  SELECT 
  tweet.tweet,
  COUNT(DISTINCT(like.like_id)) AS likes,
  COUNT(DISTINCT(reply.reply)) AS replies,
  
  tweet.date_time AS dateTime
  FROM tweet
  INNER JOIN reply
  ON tweet.tweet_id = reply.tweet_id
  INNER JOIN like
  ON like.tweet_id = reply.tweet_id
  WHERE tweet.user_id = '${userId}'
  GROUP BY tweet.tweet   `
  const tweetsList = await db.all(getUserTweetsList)
  response.send(tweetsList)
})

//API 10 Create a tweet in the tweet table

app.post('/user/tweets/', authenticationToken, async (request, response) => {
  const {tweet} = request.body
  const {username} = request
  const userId = await getUserId(username)
  const myDate = new Date()
  const dateTime = `${myDate.getFullYear()}-${
    myDate.getMonth() + 1
  }-${myDate.getDate()} ${myDate.getHours()}:${myDate.getMinutes()}:${myDate.getSeconds()}`
  console.log(dateTime)
  const addTweetQuery = `INSERT INTO 
    tweet(tweet, user_id,date_time)
   VALUES
    ('${tweet}', '${userId}', '${dateTime}')
  `
  const addedTweet = await db.run(addTweetQuery)

  response.send(addedTweet)
})
