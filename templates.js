const stamps = {
  blank: `stamp
 header.scroll
  importOnly
  buildHtml
  buildTxt
  metaTags
  gazetteCss
  homeButton
  viewSourceButton
  printTitle
  mediumColumns 1
 index.scroll
  header.scroll
  title Hello world
  
  Welcome to my folder.
  
  scrollVersionLink
 .gitignore
  *.html
  *.txt
  *.xml`,
  blog: `stamp
 header.scroll
  importOnly
  buildHtml
  buildTxt
  metaTags
  gazetteCss
  homeButton
  viewSourceButton
  printTitle
  mediumColumns 1
 index.scroll
  header.scroll
  title My Blog
  
  Welcome to my blog.
  
  printSnippets
  
  ## Recent Posts
 first-post.scroll
  header.scroll
  title First Post
  
  Content of the first post.
 second-post.scroll
  header.scroll
  title Second Post
  
  Content of the second post.
 .gitignore
  *.html
  *.txt
  *.xml`,
  business: `stamp
 header.scroll
  importOnly
  buildHtml
  buildTxt
  metaTags
  gazetteCss
  homeButton
  printTitle
  mediumColumns 1
 index.scroll
  header.scroll
  title My Business
  
  Welcome to our company.
  
  ## Services
  
  Details about services.
  
  ## Contact
  
  Contact information here.
 .gitignore
  *.html
  *.txt
  *.xml`
}

module.exports = { stamps }
