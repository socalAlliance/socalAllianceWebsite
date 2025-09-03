# Basic technical guidelines for URLS, redirects, and file access

> [!NOTE]
> I understand there might be some confusion regarding how to structure these things on the website. I wrote this so everyone can understand a little how the website works under the hood, and how to achieve success while writing new additions to the website.

Please access the GitHub Pages site at https://beta.socalalliance.org/ **NOT** at https://socalalliance.github.io/socalAllianceWebsite/
This is because the release version of the website (hosted seperately at https://socalalliance.org) has all files accessable beginning at the root of the domain. 

In other words, an image would be stored at https://socalalliance.org/images/image.png INSTEAD OF https://socalalliance.org/socalAllianceWebsite/images/image.png

If you visit the GitHub Pages website, redirects and images will **NOT** work correctly. 

# Writing filepaths to adhere to this principle

Please make filepaths and directory references absolute, **unless** you create a subdirectory that can be accessed relatively.

## Examples

Redirecting to the "Projects" page from anywhere on the site can be done correctly by href reference to "/projects/" **NOT** to simply "projects/"

Accessing images stored in the "images" folder at root should be done correctly by reference to a file stored at "/images/yourimage.png" **NOT** at "images/yourimage.png". 
 > [!TIP]
 > Once again, the latter filepath is acceptable if there is a subdirectory present containing the image that makes the relative filepath valid. (Ex. if the file is accessable at socalalliance.org/projects/images/image.png INSTEAD OF socalalliance.org/images/image.png)

# REMEMBER

The website is hosted on a variety of servers that are all tied to the same domain. This is done for redundancy and allows "production" and "testing" forms of the website to coexist in a clean fasion. 
A "One size fits all" solution (ex. a "base href") will most likely NOT work across all servers. Please adhere to the guidelines set above for success.

# Also

Please do not include a CNAME record in the GitHub repository. This makes accessing the GitHub Pages website impossible, as it will immediately redirect to the domain specified in the CNAME record.
